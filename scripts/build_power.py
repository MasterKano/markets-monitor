#!/usr/bin/env python3
"""Build data/power.json for the Nordic Power tab.

Sources (free; no API key except the optional ENTSO-E part; real data only, missing values are written as null and shown as n/a):
  * EEX daily settlements: the public CSV kept by MasterKano/scrape (master/eex_master.csv), read from
    raw.githubusercontent.com. Power base futures (Nordic system + zonal, DE and other EU areas),
    TTF gas, EUA, API2 coal, Guarantees of Origin (wind). History starts 1 Sep 2026 (no backfill).
  * Day-ahead prices per bidding zone (Nordic zones + DE-LU, PL, LT): ENTSO-E Transparency A44 when the token is
    set (92 days of history, 15-min MTU averaged to hourly for display). Fallbacks per zone: Fraunhofer ISE
    Energy-Charts API (CC BY 4.0), Energinet's Energi Data Service (DK1, DK2, NO2, SE3, SE4, DE), then
    spot-hinta.fi (today/tomorrow only). Daily averages from earlier runs are kept.
  * Generation per bidding zone (Energy-Charts public_power, when available) for computed capture prices.
  * Hydro: NVE magasinstatistikk API (Norway, weekly). Sweden: Energiföretagen weekly PDF snapshot.
  * Svenska kraftnät (no key): Kontrollrummet consumption forecast/outcome and solar plans per bidding area,
    Sweden production by type, and data.svk.se physical flows (CC BY 4.0) into / out of SE4.
  * ENTSO-E Transparency (env ENTSOE_API_TOKEN, GitHub secret of the same name; skipped when unset): SE4 wind/solar
    actual (A75) vs day-ahead forecast (A69), load actual vs day-ahead forecast (A65) + week-ahead min/max,
    physical flows on SE4 borders (A11), outages aggregated without unit names (A80/A78), weekly reservoir
    stored energy (A72) for SE1-4 / NO1-5, and computed wind/solar capture prices.

Usage: python scripts/build_power.py [--out data/power.json] [--skip-spot] [--eex-csv PATH]
"""
import argparse, datetime as dt, io, json, math, os, random, re, sys, time
from zoneinfo import ZoneInfo

import pandas as pd

try:
    from curl_cffi import requests as http
    S = http.Session(impersonate="chrome")
except Exception:  # pragma: no cover
    import requests as http
    S = http.Session()
    S.headers["User-Agent"] = "Mozilla/5.0 (X11; Linux x86_64) Chrome/124 Safari/537.36"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UTC = dt.timezone.utc
CET = ZoneInfo("Europe/Zurich")  # Geneva time = CET/CEST = Nord Pool delivery-day convention
EEX_CSV = "https://raw.githubusercontent.com/MasterKano/scrape/main/master/eex_master.csv"
HIST_START = "2026-09-01"

NORDIC_FUT = ["Nordic", "NO1", "NO2", "NO3", "NO4", "NO5", "SE1", "SE2", "SE3", "SE4", "FI"]
EU_FUT = ["DE", "FR", "NL", "GB", "ES", "IT"]
SPOT_ZONES = ["NO1", "NO2", "NO3", "NO4", "NO5", "SE1", "SE2", "SE3", "SE4", "FI", "DK1", "DK2", "DE-LU", "PL", "LT"]
NORDIC_SPOT = SPOT_ZONES[:12]
SPOT_KEEP_DAYS = 95
EDS_MAP = {"DK1": "DK1", "DK2": "DK2", "NO2": "NO2", "SE3": "SE3", "SE4": "SE4", "DE-LU": "DE"}
MON = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def log(*a):
    msg = " ".join(str(x) for x in a)
    t = (os.environ.get("ENTSOE_API_TOKEN") or "").strip()
    if t:
        msg = msg.replace(t, "***")
    print(re.sub(r"(securityToken=)[^&\s'\"]+", r"\1***", msg), file=sys.stderr, flush=True)


def get(url, tries=4, ok=(200,), **kw):
    err = None
    for i in range(tries):
        try:
            r = S.get(url, timeout=60, **kw)
            if r.status_code in ok:
                return r
            err = IOError(f"HTTP {r.status_code}")
            if r.status_code == 429:
                wait = float(r.headers.get("Retry-After") or 35)
                log(f"  429 from {url[:80]} -> wait {wait:.0f}s")
                time.sleep(min(90, wait) + random.uniform(0, 2))
                continue
            if r.status_code in (400, 401, 403, 404):
                break
        except Exception as e:
            err = e
        time.sleep(min(20, 2 ** (i + 1)) + random.uniform(0, 1))
    raise err


def rnd(x, n=2):
    try:
        x = float(x)
    except Exception:
        return None
    return None if math.isnan(x) or math.isinf(x) else round(x, n)


# ------------------------------------------------------------------ EEX futures
def tenor_start(delivery):
    """'Nov-26' -> 2026-11-01, 'Q1-27' -> 2027-01-01, 'Cal-27' -> 2027-01-01 (with type)."""
    d = delivery.split()[-1] if " " in delivery else delivery
    m = re.match(r"^(Cal|Q[1-4]|Winter|Summer|[A-Z][a-z]{2})-(\d{2})$", d)
    if not m:
        return None, None
    k, yy = m.group(1), 2000 + int(m.group(2))
    if k == "Cal":
        return dt.date(yy, 1, 1), "Y"
    if k[0] == "Q" and k[1:].isdigit():
        return dt.date(yy, 3 * (int(k[1]) - 1) + 1, 1), "Q"
    if k == "Winter":
        return dt.date(yy, 10, 1), "S"
    if k == "Summer":
        return dt.date(yy, 4, 1), "S"
    return dt.date(yy, MON[k], 1), "M"


def change_set(s, asof):
    """s: Series(date-> price) for one contract. Returns last, d1, w1, s1 (+ since date)."""
    s = s.dropna().sort_index()
    s = s[s.index <= asof]
    if s.empty or s.index[-1] != asof:
        return None
    last = float(s.iloc[-1])
    prev = s.iloc[:-1]
    d1 = last - float(prev.iloc[-1]) if len(prev) else None
    wk = s[s.index <= (pd.Timestamp(asof) - pd.Timedelta(days=7)).strftime("%Y-%m-%d")]
    w1 = last - float(wk.iloc[-1]) if len(wk) else None
    s1 = last - float(s.iloc[0]) if len(s) > 1 else None
    out = dict(p=rnd(last), d1=rnd(d1), w1=rnd(w1), s1=rnd(s1))
    if s.index[0] > HIST_START:
        out["from"] = s.index[0]          # contract listed after 1 Sep: change since listing
    return out


def build_eex(csv_path=None):
    if csv_path:
        raw = open(csv_path, "rb").read()
        src = csv_path
    else:
        raw = get(EEX_CSV).content
        src = EEX_CSV
    df = pd.read_csv(io.BytesIO(raw), dtype={"tradeDate": str, "delivery": str})
    df = df[(df["status"] == "ok") & df["settlementPrice"].notna() & (df["tradeDate"] >= HIST_START)]
    df = df.drop_duplicates(["marketGroup", "area", "product", "delivery", "tradeDate"], keep="last")
    pw = df[(df["marketGroup"] == "POWER") & (df["product"] == "Base")]
    dates = sorted(pw["tradeDate"].unique())
    asof = dates[-1]
    log(f"EEX: {len(df)} rows, power trade dates {dates[0]}..{asof}")

    # tenors: contracts not yet in delivery on the as-of trade date
    asof_d = dt.date.fromisoformat(asof)
    tens = {}
    for dlv in pw.loc[pw["tradeDate"] == asof, "delivery"].unique():
        st, typ = tenor_start(dlv)
        if st and st > asof_d:
            tens[dlv] = (typ, st)
    order = sorted(tens, key=lambda k: ("MQY".index(tens[k][0]), tens[k][1]))
    tenors = [dict(c=k, t=tens[k][0], start=tens[k][1].isoformat()) for k in order]
    in_delivery = sorted({d for d in pw.loc[pw["tradeDate"] == asof, "delivery"].unique() if d not in tens})

    piv = pw.pivot_table(index="tradeDate", columns=["area", "delivery"], values="settlementPrice", aggfunc="last")
    zones = {}
    for z in NORDIC_FUT + EU_FUT:
        row = {}
        for t in tenors:
            key = (z, t["c"])
            row[t["c"]] = change_set(piv[key], asof) if key in piv.columns else None
        zones[z] = row
    # history for benchmark contracts (front month, front quarter, front year)
    bench = {}
    for typ in "MQY":
        c = next((t["c"] for t in tenors if t["t"] == typ), None)
        if c:
            bench[typ] = c
    hist = {}
    for z in NORDIC_FUT + ["DE"]:
        hist[z] = {}
        for typ, c in bench.items():
            if (z, c) in piv.columns:
                s = piv[(z, c)].reindex(dates)
                hist[z][c] = [rnd(v) for v in s]
    # volumes / open interest (front year) for context
    oi = {}
    if "Y" in bench:
        last = pw[(pw["tradeDate"] == asof) & (pw["delivery"] == bench["Y"])]
        for _, r in last.iterrows():
            oi[r["area"]] = rnd(r["grossOpenInterest"], 0)

    # drivers
    def series(mg, delivery, product=None):
        x = df[(df["marketGroup"] == mg) & (df["delivery"] == delivery)]
        if product:
            x = x[x["product"] == product]
        return x.set_index("tradeDate")["settlementPrice"].sort_index()

    def driver(key, name, unit, mg, delivery, note=None, product=None):
        s = series(mg, delivery, product)
        if s.empty:
            return dict(key=key, name=name, unit=unit, contract=delivery, p=None, note=note)
        last_d = s.index[-1]
        cs = change_set(s, last_d) or {}
        return dict(key=key, name=name, unit=unit, contract=delivery, asof=last_d, note=note,
                    dates=list(s.index), hist=[rnd(v, 3) for v in s], **cs)

    def front(mg, prefix, typ="M"):
        cands = []
        for dlv in df.loc[(df["marketGroup"] == mg) & (df["tradeDate"] == df.loc[df["marketGroup"] == mg, "tradeDate"].max()), "delivery"].unique():
            st, t = tenor_start(dlv)
            if st and t == typ and st > asof_d and dlv.startswith(prefix):
                cands.append((st, dlv))
        return min(cands)[1] if cands else None

    dec = f"Dec-{asof_d.year % 100:02d}" if asof_d.month < 12 else f"Dec-{(asof_d.year + 1) % 100:02d}"
    cal1 = f"Cal-{(asof_d.year + 1) % 100:02d}"
    drivers = [
        driver("ttf_m", "TTF gas front month", "EUR/MWh", "GAS_FUTURES", front("GAS_FUTURES", "Gas Month") or ""),
        driver("ttf_y", "TTF gas " + cal1, "EUR/MWh", "GAS_FUTURES", "Gas " + cal1),
        driver("ttf_da", "TTF gas day-ahead", "EUR/MWh", "GAS_SPOT", "TTF Day-Ahead", note="EEX spot index incl. weekend deliveries"),
        driver("eua", "EUA " + dec, "EUR/t", "EUA_FUTURES", "EUA " + dec),
        driver("coal", "API2 coal " + dec, "USD/t", "ICE_COAL_FUTURES", "Coal " + dec, note="ICE Rotterdam coal futures, USD/t"),
        driver("go", "GoO wind " + cal1, "EUR/MWh", "GO_FUTURES", "GO Wind " + cal1, note="EEX European Guarantees of Origin, wind, " + cal1),
    ]
    areas = sorted(pw["area"].unique())
    cov = dict(rows=int(len(df)), first=dates[0], last=asof, trade_dates=len(dates), areas=areas,
               tenor_types=sorted(pw["maturityType"].unique()),
               groups=sorted(df["marketGroup"].unique()))
    return dict(source=src, asof=asof, dates=dates, tenors=tenors, in_delivery=in_delivery, zones=zones,
                bench=bench, hist=hist, oi=oi, drivers=drivers, coverage=cov)


# ------------------------------------------------------------------ day-ahead spot
def ec_price(bzn, start, end):
    r = get("https://api.energy-charts.info/price", params=dict(bzn=bzn, start=start, end=end), tries=3)
    js = r.json()
    ts, px = js.get("unix_seconds") or [], js.get("price") or []
    if not ts:
        raise LookupError("no data")
    s = pd.Series(px, index=pd.to_datetime(ts, unit="s", utc=True), dtype="float64")
    return s, (js.get("unit") or "EUR / MWh")


def eds_prices(start, end):
    """Energinet Energi Data Service: DayAheadPrices for DK1, DK2, NO2, SE3, SE4, DE (15-min, EUR)."""
    flt = json.dumps({"PriceArea": sorted(set(EDS_MAP.values()))})
    r = get("https://api.energidataservice.dk/dataset/DayAheadPrices",
            params=dict(start=start + "T00:00", end=end + "T00:00", filter=flt, limit="0", timezone="UTC"))
    recs = r.json().get("records") or []
    out = {}
    if not recs:
        return out
    d = pd.DataFrame(recs)
    d["t"] = pd.to_datetime(d["TimeUTC"], utc=True)
    for area, g in d.groupby("PriceArea"):
        out[area] = g.set_index("t")["DayAheadPriceEUR"].astype(float).sort_index()
    return out


def full_day(d, g):
    """True if series g covers the whole Geneva-time delivery day d (handles 23/25-hour DST days)."""
    t0 = dt.datetime.combine(d, dt.time(), CET).astimezone(UTC)
    t1 = dt.datetime.combine(d + dt.timedelta(days=1), dt.time(), CET).astimezone(UTC)
    if len(g) < 2:
        return False
    step = (g.index[1] - g.index[0]).total_seconds()
    need = round((t1 - t0).total_seconds() / step)
    return g.index[0] == pd.Timestamp(t0) and len(g) >= need


def summarise_zone(s, today):
    """s: price series (UTC index, 15-min or hourly). -> daily averages (complete days only) + hourly detail for recent days."""
    s = s.dropna().sort_index()
    s = s[~s.index.duplicated(keep="last")]
    loc = s.tz_convert(CET)
    day = pd.Index([t.date() for t in loc.index])
    daily, hours = [], {}
    for d, g in s.groupby(day):
        full = full_day(d, g)
        if full:
            daily.append([d.isoformat(), rnd(g.mean())])
        if d >= today - dt.timedelta(days=1) and len(g) >= 4:
            h = g.resample("1h").mean()                                     # 15-min -> hourly (UTC hours)
            step = (g.index[1] - g.index[0]).total_seconds() / 60 if len(g) > 1 else 60
            t0 = h.index[0].isoformat().replace("+00:00", "Z")
            hours[d.isoformat()] = dict(t0=t0, h=[rnd(v) for v in h], avg=rnd(g.mean()) if full else None,
                                        min=rnd(g.min()), max=rnd(g.max()), neg=int((g < 0).sum()), res=int(step),
                                        full=full)
    return daily, hours


def spot_hinta(zone):
    """spot-hinta.fi: today + tomorrow (when published), 15-min, EUR/kWh excl. tax. Fallback only."""
    r = get("https://api.spot-hinta.fi/TodayAndDayForward", params=dict(region=zone), tries=3)
    js = r.json()
    if not js:
        raise LookupError("no data")
    idx = pd.to_datetime([x["DateTime"] for x in js], utc=True)
    return pd.Series([x["PriceNoTax"] * 1000 for x in js], index=idx, dtype="float64")


def build_spot(today, primary=None, primary_status=None):
    """primary: {zone: series} from ENTSO-E A44 (when the token is set). Energy-Charts, Energi Data Service and
    spot-hinta.fi are only used for zones the primary source did not return."""
    start = (today - dt.timedelta(days=32)).isoformat()
    end = (today + dt.timedelta(days=1)).isoformat()
    zones, status, raw = {}, list(primary_status or []), {}
    for z, s in (primary or {}).items():
        if z in SPOT_ZONES and s is not None and len(s):
            raw[z] = ("ENTSO-E", s)
    ec_zones = [z for z in SPOT_ZONES if z not in raw]
    for i, z in enumerate(ec_zones):
        if i:
            time.sleep(31)  # Energy-Charts rate limit on /price: ~2 requests/minute
        try:
            s, unit = ec_price(z, start, end)
            raw[z] = ("Energy-Charts", s)
            status.append(dict(zone=z, src="Energy-Charts", ok=True, n=int(s.notna().sum()), last=s.dropna().index[-1].isoformat()))
            log(f"spot {z}: {s.notna().sum()} pts via Energy-Charts")
        except Exception as e:
            status.append(dict(zone=z, src="Energy-Charts", ok=False, error=str(e)[:160]))
            log(f"spot {z}: Energy-Charts failed: {e}")
            if i == 1 and not any(x["ok"] and x["src"] == "Energy-Charts" for x in status):
                log("Energy-Charts unavailable for the first two zones - skipping the rest")
                for z2 in ec_zones[2:]:
                    status.append(dict(zone=z2, src="Energy-Charts", ok=False, error="skipped (API unavailable)"))
                break
    missing = [z for z in SPOT_ZONES if z not in raw and z in EDS_MAP]
    if missing:
        try:
            eds = eds_prices(start, (today + dt.timedelta(days=2)).isoformat())
            for z in missing:
                s = eds.get(EDS_MAP[z])
                if s is not None and len(s):
                    raw[z] = ("Energi Data Service", s)
                    status.append(dict(zone=z, src="Energi Data Service", ok=True, n=int(len(s)), last=s.index[-1].isoformat()))
                    log(f"spot {z}: {len(s)} pts via Energi Data Service")
        except Exception as e:
            status.append(dict(zone="*", src="Energi Data Service", ok=False, error=str(e)[:160]))
            log(f"EDS failed: {e}")
    for z in SPOT_ZONES:
        if z in raw or z in ("DE-LU", "PL"):
            continue
        try:
            s = spot_hinta(z)
            raw[z] = ("spot-hinta.fi", s)
            status.append(dict(zone=z, src="spot-hinta.fi", ok=True, n=int(len(s)), last=s.index[-1].isoformat()))
            log(f"spot {z}: {len(s)} pts via spot-hinta.fi (today/tomorrow only)")
        except Exception as e:
            status.append(dict(zone=z, src="spot-hinta.fi", ok=False, error=str(e)[:160]))
        time.sleep(1.5)
    for z, (src, s) in raw.items():
        daily, hours = summarise_zone(s, today)
        zones[z] = dict(src=src, daily=daily, days=hours)
    srcs = sorted({v[0] for v in raw.values()})
    return dict(zones=zones, status=status, sources=srcs, raw=raw)


# ------------------------------------------------------------------ generation / capture prices
def build_capture(raw_prices, today):
    """Wind/solar capture prices per zone where Energy-Charts publishes zone-level generation.
    capture = sum(price_t * gen_t) / sum(gen_t) over the last 30 delivery days. Computed, not a published series."""
    out, status = {}, []
    start = (today - dt.timedelta(days=30)).isoformat()
    end = (today - dt.timedelta(days=1)).isoformat()
    targets = [("FI", "fi"), ("DE-LU", "de")]
    for i, (z, code) in enumerate(targets):
        if z not in raw_prices:
            continue
        if i:
            time.sleep(31)
        try:
            js = get("https://api.energy-charts.info/public_power", params=dict(country=code, start=start, end=end), tries=2).json()
            idx = pd.to_datetime(js["unix_seconds"], unit="s", utc=True)
            res = {}
            for pt in js.get("production_types", []):
                nm = pt.get("name", "")
                key = "wind" if re.fullmatch(r"Wind (on|off)shore", nm) else "solar" if nm == "Solar" else None
                if not key:
                    continue
                g = pd.Series(pt["data"], index=idx, dtype="float64")
                res.setdefault(key, []).append(g)
            row = {}
            for key, parts in res.items():
                g = pd.concat(parts, axis=1).sum(axis=1, min_count=1).clip(lower=0)
                p = raw_prices[z][1].reindex(g.index, method="ffill")
                ok = g.notna() & p.notna()
                if ok.sum() < 24 * 4 * 7 or g[ok].sum() <= 0:
                    continue
                cap = float((g[ok] * p[ok]).sum() / g[ok].sum())
                base = float(p[ok].mean())
                row[key] = dict(cap=rnd(cap), base=rnd(base), ratio=rnd(cap / base, 3) if base else None)
            if row:
                out[z] = dict(row, start=start, end=end)
            status.append(dict(zone=z, ok=bool(row)))
        except Exception as e:
            status.append(dict(zone=z, ok=False, error=str(e)[:160]))
            log(f"capture {z}: {e}")
    return dict(zones=out, status=status)


# ------------------------------------------------------------------ hydro
def build_hydro_no():
    base = "https://biapi.nve.no/magasinstatistikk/api/Magasinstatistikk/"
    last = get(base + "HentOffentligDataSisteUke").json()
    mm = get(base + "HentOffentligDataMinMaxMedian").json()
    allw = get(base + "HentOffentligData").json()
    d = pd.DataFrame(allw)
    d = d[d["omrType"].isin(["NO", "EL"])]
    yr = int(max(x["iso_aar"] for x in last))
    regions = {}
    for typ, nr, label in [("NO", 0, "Norway")] + [("EL", i, f"NO{i}") for i in range(1, 6)]:
        cur = d[(d["omrType"] == typ) & (d["omrnr"] == nr)]
        def wk(y):
            x = cur[cur["iso_aar"] == y].set_index("iso_uke")["fyllingsgrad"].sort_index()
            return [[int(w), rnd(v * 100, 1)] for w, v in x.items()]
        band = sorted((x for x in mm if x["omrType"] == typ and x["omrnr"] == nr), key=lambda x: x["iso_uke"])
        lw = next((x for x in last if x["omrType"] == typ and x["omrnr"] == nr), None)
        regions[label] = dict(
            cur=wk(yr), prev=wk(yr - 1),
            band=[[x["iso_uke"], rnd(x["minFyllingsgrad"] * 100, 1), rnd(x["medianFyllingsGrad"] * 100, 1),
                   rnd(x["maxFyllingsgrad"] * 100, 1)] for x in band],
            last=dict(week=lw["iso_uke"], date=lw["dato_Id"], fill=rnd(lw["fyllingsgrad"] * 100, 1),
                      chg=rnd(lw["endring_fyllingsgrad"] * 100, 1), twh=rnd(lw["fylling_TWh"], 1),
                      cap=rnd(lw["kapasitet_TWh"], 1)) if lw else None)
    nxt = next((x.get("neste_Publiseringsdato") for x in last if x.get("neste_Publiseringsdato")), None)
    return dict(year=yr, regions=regions, next=nxt, band_period="2006-2025",
                source="NVE magasinstatistikk (biapi.nve.no)")


def build_hydro_se():
    """Energiföretagen weekly 'Aktuellt magasinsläge' PDF: snapshot only (no history API)."""
    from pypdf import PdfReader
    url = "https://www.energiforetagen.se/globalassets/energiforetagen/statistik/kraftlaget/aktuellt-magasinslage-sverige-veckorapport.pdf"
    r = get(url)
    t = PdfReader(io.BytesIO(r.content)).pages[0].extract_text()
    t = re.sub(r"\s+", " ", t.replace("\u00a0", " "))
    num = lambda s: float(s.replace(" ", "").replace(",", "."))
    wk = re.search(r"Vecka (\d+) (\d+ \w+ - \d+ \w+) år (\d{4})", t)
    ch = re.search(r"från ([\d,]+) % till ([\d,]+) %", t)
    mean = re.search(r"1960-2025 är ([\d,]+) %", t)
    tot = re.search(r"beräknat till ([\d ]+) GWh", t)
    zones = {m.group(1): dict(fill=num(m.group(2)), gwh=num(m.group(3)))
             for m in re.finditer(r"(SE[1-4]) ([\d,]+) (\d{1,3}(?: \d{3})*)(?!\d)", t)}
    if not (wk and ch):
        raise LookupError("could not parse Energiföretagen PDF")
    return dict(week=int(wk.group(1)), period=wk.group(2), year=int(wk.group(3)), fill=num(ch.group(2)),
                prev=num(ch.group(1)), mean=num(mean.group(1)) if mean else None,
                gwh=num(tot.group(1)) if tot else None, zones=zones, source=url,
                mean_period="1960-2025")


# ------------------------------------------------------------------ Svenska kraftnät (free, no key)
SVK_CR = "https://www.svk.se/services/controlroom/v2"
SVK_DS = "https://data.svk.se/api/3/action/datastore_search"
SVK_FLOWS = "4aa94b88-9f42-4f0a-a6a8-8e47aadc782a"     # data.svk.se "Physical Power Flows" (CC BY 4.0), 15-min
SVK_PROD_IDS = {"1": "total", "2": "nuclear", "3": "hydro", "4": "thermal", "5": "wind", "6": "unspecified",
                "7": "consumption", "8": "net_export"}  # Kontrollrummet production graph series ids (Sweden)
SE_ZONES = ["SE1", "SE2", "SE3", "SE4"]


def _svk_json(url, params):
    r = get(url, tries=2, params=params, headers={"Accept": "application/json"})
    return r.json()


def _xy_series(data):
    """Kontrollrummet [{x: ms UTC, y: MW}] -> pd.Series (UTC)."""
    pts = [(p["x"], p["y"]) for p in data or [] if p.get("y") is not None]
    if not pts:
        return None
    return pd.Series([v for _, v in pts], index=pd.to_datetime([t for t, _ in pts], unit="ms", utc=True), dtype="float64")


def build_svk(today):
    """Svenska kraftnät open data for the SE4 section (all keyless):
      * Kontrollrummet 'situation': consumption forecast ('planned') and outcome ('result') per bidding area, hourly.
      * Kontrollrummet 'productionplans': solar production plans per bidding area (balance-responsible parties).
      * Kontrollrummet 'production': Sweden-wide production by type (nuclear, hydro, thermal, wind, unspecified),
        consumption and net export, 15-min. Not split by bidding area at source.
      * data.svk.se Physical Power Flows (CC BY 4.0): flows into / out of SE4 per border, 15-min.
    Each part is optional; failures are listed in svk.errors and the page shows n/a for that part."""
    t0 = dt.datetime.combine(today - dt.timedelta(days=6), dt.time(), CET).astimezone(UTC)
    t1 = dt.datetime.combine(today + dt.timedelta(days=2), dt.time(), CET).astimezone(UTC)
    idx = pd.date_range(t0, t1, freq="1h", inclusive="left", tz="UTC")
    days = [today + dt.timedelta(days=i) for i in range(-6, 2)]
    res = dict(source="Svenska kraftnät", t0=idx[0].isoformat().replace("+00:00", "Z"), n=len(idx), zones={}, errors=[])
    hourly = lambda s: [rnd(v, 0) for v in s.resample("1h").mean().reindex(idx)] if s is not None and len(s) else None

    def call(what, fn):
        try:
            return fn()
        except Exception as e:
            res["errors"].append(dict(part=what, error=str(e)[:160]))
            log(f"svk {what}: {e}")
            return None
        finally:
            time.sleep(0.3)

    # consumption per bidding area (SE4: 8 days; SE1-SE3: yesterday/today/tomorrow for the zone split)
    for z in SE_ZONES:
        plan, act = [], []
        for d in (days if z == "SE4" else days[-3:]):
            js = call(f"situation {z} {d}", lambda: _svk_json(f"{SVK_CR}/situation", dict(date=d.isoformat(), biddingArea=z)))
            for ser in (js or {}).get("Data") or []:
                s_ = _xy_series(ser.get("data"))
                if s_ is not None:
                    (plan if ser.get("id") == "planned" else act if ser.get("id") == "result" else []).append(s_)
        zr = {}
        if plan:
            zr["load_plan"] = hourly(pd.concat(plan).sort_index().groupby(level=0).last())
        if act:
            zr["load"] = hourly(pd.concat(act).sort_index().groupby(level=0).last())
        # solar production plans (today + tomorrow)
        sol = []
        for d in days[-2:]:
            js = call(f"productionplans {z} {d}", lambda: _svk_json(f"{SVK_CR}/productionplans", dict(date=d.isoformat(), biddingArea=z)))
            rows = [x for x in (js or {}).get("data") or [] if x.get("productionPlanResource") == "SOLENERGI" and x.get("value") is not None]
            if rows:
                sol.append(pd.Series([x["value"] for x in rows], index=pd.to_datetime([x["dateTime"] for x in rows], utc=True), dtype="float64"))
        if sol:
            zr["solar_plan"] = hourly(pd.concat(sol).sort_index().groupby(level=0).last())
        if zr:
            res["zones"][z] = zr

    # Sweden production by type
    prod = {}
    for d in days[:-1]:
        js = call(f"production SE {d}", lambda: _svk_json(f"{SVK_CR}/production", dict(date=d.isoformat(), countryCode="SE")))
        for ser in (js or {}).get("Data") or []:
            k = SVK_PROD_IDS.get(str(ser.get("id")))
            s_ = _xy_series(ser.get("data"))
            if k and s_ is not None:
                prod.setdefault(k, []).append(s_)
    if prod:
        res["se"] = {k: hourly(pd.concat(v).sort_index().groupby(level=0).last()) for k, v in prod.items()}

    # SE4 physical flows per border (positive = import into SE4)
    def flows():
        since = t0.strftime("%Y-%m-%dT%H:%M:%S")
        net = {}
        for side, sign in (("to_bidding_zone", 1), ("from_bidding_zone", -1)):
            js = _svk_json(SVK_DS, dict(resource_id=SVK_FLOWS, limit=32000, sort="start_time_utc asc",
                                        filters=json.dumps({side: "SE4", "start_time_utc": {"gte": since}})))
            if not js.get("success"):
                raise IOError("datastore_search failed")
            for r in js["result"]["records"]:
                other = r["from_bidding_zone"] if sign > 0 else r["to_bidding_zone"]
                if other == "SE4" or r.get("power") is None:
                    continue
                net.setdefault(other.replace("DELU", "DE-LU"), []).append((r["start_time_utc"], sign * float(r["power"])))
        out = {}
        for k, rows in net.items():
            s_ = pd.Series([v for _, v in rows], index=pd.to_datetime([t for t, _ in rows], utc=True), dtype="float64")
            out[k] = hourly(s_.groupby(level=0).sum())
        return out
    fl = call("flows SE4", flows)
    if fl:
        res["flows_se4"] = fl
    if not res["zones"] and not res.get("se") and not res.get("flows_se4"):
        raise RuntimeError("; ".join(e["error"] for e in res["errors"][:3])[:300] or "no SVK data")
    return res


# ------------------------------------------------------------------ ENTSO-E Transparency (needs ENTSOE_API_TOKEN)
# The token is read from the environment only and never logged: every message that can contain a request URL
# goes through _redact(). Requests are throttled well below the 400/min limit and retried on 429/5xx.
ENTSOE_API = "https://web-api.tp.entsoe.eu/api"
ENTSOE_EIC = {"NO1": "10YNO-1--------2", "NO2": "10YNO-2--------T", "NO3": "10YNO-3--------J",
              "NO4": "10YNO-4--------9", "NO5": "10Y1001A1001A48H",
              "SE1": "10Y1001A1001A44P", "SE2": "10Y1001A1001A45N", "SE3": "10Y1001A1001A46L", "SE4": "10Y1001A1001A47J",
              "FI": "10YFI-1--------U", "DK1": "10YDK-1--------W", "DK2": "10YDK-2--------M",
              "DE-LU": "10Y1001A1001A82H", "PL": "10YPL-AREA-----S", "LT": "10YLT-1001A0008Q"}
SE4_BORDERS = ["SE3", "DK2", "DE-LU", "PL", "LT"]
RES_ZONES = ["SE1", "SE2", "SE3", "SE4", "NO1", "NO2", "NO3", "NO4", "NO5"]
PSR = {"B19": "wind", "B18": "wind", "B16": "solar", "B14": "nuclear", "B12": "hydro", "B11": "hydro",
       "B10": "hydro", "B04": "gas", "B05": "coal", "B06": "oil", "B01": "biomass", "B17": "waste", "B20": "other"}
_RES = {"PT1M": 1, "PT15M": 15, "PT30M": 30, "PT60M": 60, "P1D": 1440, "P7D": 10080}
_ENT_GAP = 0.25          # seconds between requests (<= 240/min, limit is 400/min)
_ent_last = [0.0]


def _token():
    return (os.environ.get("ENTSOE_API_TOKEN") or "").strip()


def _redact(msg):
    msg = str(msg)
    t = _token()
    if t:
        msg = msg.replace(t, "***")
    return re.sub(r"(securityToken=)[^&\s'\"]+", r"\1***", msg)


def _strip_ns(xml_text):
    import xml.etree.ElementTree as ET
    root = ET.fromstring(xml_text)
    for el in root.iter():
        if "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def _ack(root):
    if root.tag.startswith("Acknowledgement"):
        reason = " ".join((t.text or "") for t in root.iter("text")).strip()
        raise LookupError(reason[:160] or "no data")


def _periods(ts):
    """Yield pd.Series (UTC) for each Period of a TimeSeries. A03 curves: omitted positions repeat the previous
    value. Prices use <price.amount>, everything else <quantity>."""
    for per in ts.iter():
        if per.tag not in ("Period", "Available_Period"):   # unavailability docs use Available_Period
            continue
        start = pd.Timestamp(per.findtext("timeInterval/start")).tz_convert("UTC")
        end = pd.Timestamp(per.findtext("timeInterval/end")).tz_convert("UTC")
        step = _RES.get(per.findtext("resolution") or "", 60)
        n = max(1, int(round((end - start).total_seconds() / (step * 60))))
        pts = {}
        for p in per.iter("Point"):
            v = p.findtext("quantity")
            if v is None:
                v = p.findtext("price.amount")
            if v is not None:
                pts[int(p.findtext("position"))] = float(v)
        vals, last = [], None
        for i in range(1, n + 1):
            last = pts.get(i, last)
            vals.append(last)
        idx = pd.date_range(start, periods=n, freq=f"{step}min")
        yield step, pd.Series(vals, index=idx, dtype="float64")


def entsoe_parse(xml_text):
    """-> list of dicts {psr, is_in, step, s} (one per TimeSeries, periods concatenated)."""
    root = _strip_ns(xml_text)
    _ack(root)
    out = []
    for ts in root.iter("TimeSeries"):
        parts = list(_periods(ts))
        if not parts:
            continue
        s = pd.concat([p[1] for p in parts]).sort_index()
        s = s[~s.index.duplicated(keep="last")]
        out.append(dict(psr=ts.findtext("MktPSRType/psrType"),
                        is_in=ts.find("inBiddingZone_Domain.mRID") is not None or ts.find("outBiddingZone_Domain.mRID") is None,
                        step=min(p[0] for p in parts), s=s))
    return out


def entsoe_raw(params, tries=4):
    token = _token()
    if not token:
        raise PermissionError("ENTSOE_API_TOKEN not set")
    last = None
    for i in range(tries):
        wait = _ENT_GAP - (time.time() - _ent_last[0])
        if wait > 0:
            time.sleep(wait)
        _ent_last[0] = time.time()
        try:
            r = S.get(ENTSOE_API, params=dict(params, securityToken=token), timeout=90)
        except Exception as e:
            last = IOError(_redact(f"{type(e).__name__}: {e}")[:200])
            time.sleep(3 * (i + 1))
            continue
        if r.status_code == 401:
            raise PermissionError("ENTSO-E rejected the token (HTTP 401)")
        if r.status_code == 429 or r.status_code >= 500:
            last = IOError(f"HTTP {r.status_code}")
            time.sleep(min(60, float(r.headers.get("Retry-After") or 0) or 6 * (i + 1)))
            continue
        if r.status_code not in (200, 400):
            raise IOError(f"HTTP {r.status_code}")
        return r
    raise last


def entsoe_get(params):
    r = entsoe_raw(params)
    return entsoe_parse(r.text)


def entsoe_docs(params):
    """Unavailability queries (A78/A80) answer with a zip of XML documents (or a single XML / acknowledgement)."""
    import zipfile
    r = entsoe_raw(params)
    if r.content[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(r.content))
        return [_strip_ns(z.read(n)) for n in z.namelist()]
    root = _strip_ns(r.text)
    _ack(root)
    return [root]


def _ts(t):
    return t.isoformat().replace("+00:00", "Z")


def _cet_bounds(d0, d1):
    """Geneva-time days [d0, d1) -> UTC Timestamps."""
    a = dt.datetime.combine(d0, dt.time(), CET).astimezone(UTC)
    b = dt.datetime.combine(d1, dt.time(), CET).astimezone(UTC)
    return pd.Timestamp(a), pd.Timestamp(b)


def _period(d0, d1):
    a, b = _cet_bounds(d0, d1)
    return dict(periodStart=a.strftime("%Y%m%d%H%M"), periodEnd=b.strftime("%Y%m%d%H%M"))


def _combine(items):
    """Several TimeSeries for the same quantity (e.g. revisions or mixed resolutions): finest resolution first."""
    s = None
    for it in sorted(items, key=lambda x: x["step"]):
        s = it["s"] if s is None else s.combine_first(it["s"])
    return s


def _sum(items):
    if not items:
        return None
    if len(items) == 1:
        return items[0]
    df = pd.concat(items, axis=1).sort_index()
    df = df.ffill(limit=3)  # hourly series on a 15-min grid
    return df.sum(axis=1, min_count=1)


def entsoe_prices(today, days=92):
    """A44 day-ahead prices for all zones; delivery days [today-days, today+2). -> {zone: series}, status."""
    out, status = {}, []
    per = _period(today - dt.timedelta(days=days), today + dt.timedelta(days=2))
    for z, eic in ENTSOE_EIC.items():
        try:
            items = entsoe_get(dict(documentType="A44", in_Domain=eic, out_Domain=eic, **per))
            s = _combine(items)
            if s is None or s.notna().sum() == 0:
                raise LookupError("empty")
            out[z] = s.dropna()
            status.append(dict(zone=z, src="ENTSO-E", ok=True, n=int(len(out[z])), last=_ts(out[z].index[-1])))
            log(f"spot {z}: {len(out[z])} pts via ENTSO-E")
        except PermissionError:
            raise
        except Exception as e:
            status.append(dict(zone=z, src="ENTSO-E", ok=False, error=_redact(e)[:160]))
            log(f"spot {z}: ENTSO-E failed: {_redact(e)}")
    return out, status


def _hourly(s, idx):
    if s is None:
        return [None] * len(idx)
    h = s.resample("1h").mean().reindex(idx)
    return [None if pd.isna(v) else int(round(v)) for v in h]


def _weighted(price, gen, a, b):
    """Generation-weighted price over [a, b): sum(p*g)/sum(g), plus the time-average of p over the same periods."""
    p = price[(price.index >= a) & (price.index < b)]
    if gen is None or not len(p):
        return None
    g = gen.reindex(p.index)
    if g.isna().mean() > 0.5:   # e.g. hourly generation vs 15-min prices
        g = gen.resample("15min").ffill(limit=3).reindex(p.index)
    ok = p.notna() & g.notna()
    g = g.clip(lower=0)
    if ok.sum() < 0.8 * len(p) or g[ok].sum() <= 0:
        return None
    cap = float((p[ok] * g[ok]).sum() / g[ok].sum())
    base = float(p[ok].mean())
    return dict(base=rnd(base), cap=rnd(cap), rate=rnd(cap / base, 3) if base > 0 else None,
                mw=rnd(g[ok].mean(), 0))


def _docs_latest(docs):
    """Unavailability docs -> latest revision per mRID, cancelled/withdrawn (A09/A13) dropped."""
    best = {}
    for d in docs:
        mrid = d.findtext("mRID") or str(id(d))
        rev = int(d.findtext("revisionNumber") or 0)
        if mrid not in best or rev > best[mrid][0]:
            best[mrid] = (rev, d)
    return [d for rev, d in best.values() if (d.findtext("docStatus/value") or "") not in ("A09", "A13")]


def entsoe_outages_gen(now, today):
    """A80 generation-unit unavailability in SE4 -> aggregated by fuel type (no unit or plant names are kept)."""
    docs = _docs_latest(entsoe_docs(dict(documentType="A80", biddingZone_Domain=ENTSOE_EIC["SE4"],
                                         **_period(today - dt.timedelta(days=1), today + dt.timedelta(days=15)))))
    now_t, wk = pd.Timestamp(now), pd.Timestamp(now) + pd.Timedelta(days=7)
    agg = {}
    for d in docs:
        for ts in d.iter("TimeSeries"):
            psr = PSR.get(ts.findtext("production_RegisteredResource.pSRType.psrType") or "", "other")
            try:
                nom = float(ts.findtext("production_RegisteredResource.pSRType.powerSystemResources.nominalP") or "nan")
            except ValueError:
                nom = float("nan")
            biz = ts.findtext("businessType") or ""
            for step, s in _periods(ts):
                if not len(s) or math.isnan(nom):
                    continue
                a, b = s.index[0], s.index[-1] + pd.Timedelta(minutes=step)
                if b <= now_t or a >= wk:
                    continue
                cur = s[(s.index <= now_t)]
                active = a <= now_t < b
                lost_now = max(0.0, nom - float(cur.iloc[-1])) if active and len(cur) else 0.0
                lost_max = max(0.0, nom - float(s.min()))
                r = agg.setdefault(psr, dict(now_mw=0.0, now_n=0, wk_mw=0.0, wk_n=0, planned=0, forced=0))
                if active and lost_now > 0:
                    r["now_mw"] += lost_now
                    r["now_n"] += 1
                if lost_max > 0:
                    r["wk_mw"] += lost_max
                    r["wk_n"] += 1
                    r["forced" if biz == "A54" else "planned"] += 1
    rows = [dict(type=k, now_mw=rnd(v["now_mw"], 0), now_n=v["now_n"], wk_mw=rnd(v["wk_mw"], 0), wk_n=v["wk_n"],
                 planned=v["planned"], forced=v["forced"]) for k, v in agg.items()]
    rows.sort(key=lambda r: -(r["wk_mw"] or 0))
    return rows


def entsoe_outages_tx(now, today):
    """A78 transmission unavailability on SE4 interconnectors -> border, direction, available MW, window, type.
    Line / asset names are not kept."""
    now_t = pd.Timestamp(now)
    rows, seen, errs = [], set(), []
    per = _period(today - dt.timedelta(days=1), today + dt.timedelta(days=31))
    for z in SE4_BORDERS:
        for a_z, b_z in (("SE4", z), (z, "SE4")):
            try:
                docs = _docs_latest(entsoe_docs(dict(documentType="A78", in_Domain=ENTSOE_EIC[b_z],
                                                     out_Domain=ENTSOE_EIC[a_z], **per)))
            except LookupError:
                continue
            except PermissionError:
                raise
            except Exception as e:
                errs.append(f"A78 {a_z}>{b_z}: {_redact(e)[:80]}")
                continue
            for d in docs:
                for ts in d.iter("TimeSeries"):
                    biz = ts.findtext("businessType") or ""
                    for step, s in _periods(ts):
                        if not len(s):
                            continue
                        t0, t1 = s.index[0], s.index[-1] + pd.Timedelta(minutes=step)
                        if t1 <= now_t:
                            continue
                        key = (a_z, b_z, t0, t1)
                        if key in seen:
                            continue
                        seen.add(key)
                        rows.append(dict(frm=a_z, to=b_z, start=_ts(t0), end=_ts(t1), avail=rnd(s.min(), 0),
                                         type="forced" if biz == "A54" else "planned", now=bool(t0 <= now_t < t1)))
    rows.sort(key=lambda r: (not r["now"], r["start"]))
    return rows[:14], errs


def entsoe_reservoirs(today):
    """A72 weekly stored energy (MWh) per zone -> last 53 weeks + the same weeks a year earlier (GWh)."""
    out, errs = {}, []
    for z in RES_ZONES:
        try:
            parts = []
            for a, b in ((today - dt.timedelta(days=760), today - dt.timedelta(days=380)),
                         (today - dt.timedelta(days=380), today + dt.timedelta(days=1))):
                try:
                    items = entsoe_get(dict(documentType="A72", processType="A16", in_Domain=ENTSOE_EIC[z], **_period(a, b)))
                    parts += [it["s"] for it in items]
                except LookupError:
                    pass
            if not parts:
                raise LookupError("no data")
            s = pd.concat(parts).sort_index()
            s = s[~s.index.duplicated(keep="last")].dropna()
            if len(s) < 2:
                raise LookupError("too few points")
            cur = s.iloc[-53:]
            prev_vals = []
            for t in cur.index:
                tt = t - pd.Timedelta(days=364)
                j = s.index.get_indexer([tt], method="nearest")[0]
                prev_vals.append(rnd(s.iloc[j] / 1000, 0) if j >= 0 and abs((s.index[j] - tt).days) <= 3 else None)
            weeks = [(t + pd.Timedelta(hours=12)).tz_convert(CET).date().isoformat() for t in cur.index]
            out[z] = dict(w=weeks, v=[rnd(v / 1000, 0) for v in cur], ly=prev_vals)
        except PermissionError:
            raise
        except Exception as e:
            errs.append(f"A72 {z}: {_redact(e)[:80]}")
    return out, errs


def build_entsoe(today, now, prices, prev):
    """SE4 detail (hourly window today-7 .. tomorrow, 30-day daily stats), interconnector flows, outages and
    reservoirs. prices: {zone: series} from A44 (or other spot sources). Missing parts keep the previous values."""
    if not _token():
        return dict(enabled=False, reason="ENTSOE_API_TOKEN not set")
    se4 = ENTSOE_EIC["SE4"]
    res = dict(enabled=True, source="ENTSO-E Transparency Platform", errors=[], stale=[])
    err = lambda k, e: (res["errors"].append(dict(q=k, error=_redact(e)[:160])), log(f"entsoe {k}: {_redact(e)}"))
    h0, h1 = _cet_bounds(today - dt.timedelta(days=7), today + dt.timedelta(days=2))
    hidx = pd.date_range(h0, h1, freq="1h", inclusive="left")
    d30 = today - dt.timedelta(days=30)
    per30 = _period(d30, today + dt.timedelta(days=2))
    S4 = {}

    def q(key, fn):
        try:
            S4[key] = fn()
        except PermissionError:
            raise
        except Exception as e:
            err(key, e)

    def gen_actual():
        items = [it for it in entsoe_get(dict(documentType="A75", processType="A16", in_Domain=se4, **_period(d30, today + dt.timedelta(days=1)))) if it["is_in"]]
        by = {}
        for it in items:
            by.setdefault(PSR.get(it["psr"], "other"), []).append(it["s"])
        return {k: _sum(v) for k, v in by.items()}

    def ws_fc():
        by = {}
        for it in entsoe_get(dict(documentType="A69", processType="A01", in_Domain=se4, **per30)):
            by.setdefault(PSR.get(it["psr"], "other"), []).append(it["s"])
        return {k: _sum(v) for k, v in by.items()}

    q("gen", gen_actual)
    q("fc", ws_fc)
    q("load", lambda: _combine(entsoe_get(dict(documentType="A65", processType="A16", outBiddingZone_Domain=se4,
                                                  **_period(d30, today + dt.timedelta(days=1))))))
    q("load_fc", lambda: _combine(entsoe_get(dict(documentType="A65", processType="A01", outBiddingZone_Domain=se4,
                                                     **_period(today - dt.timedelta(days=7), today + dt.timedelta(days=2))))))

    def load_week():
        items = entsoe_get(dict(documentType="A65", processType="A31", outBiddingZone_Domain=se4,
                                **_period(today, today + dt.timedelta(days=8))))
        df = pd.concat([it["s"] for it in items], axis=1)
        rows = []
        for t, r in df.iterrows():
            v = [x for x in r if not pd.isna(x)]
            if v:
                rows.append([(t + pd.Timedelta(hours=12)).tz_convert(CET).date().isoformat(), rnd(min(v), 0), rnd(max(v), 0)])
        return rows
    q("load_week", load_week)

    def flows():
        out = {}
        per = _period(today - dt.timedelta(days=7), today + dt.timedelta(days=1))
        for z in SE4_BORDERS:
            try:
                imp = _combine(entsoe_get(dict(documentType="A11", in_Domain=se4, out_Domain=ENTSOE_EIC[z], **per)))
                exp = _combine(entsoe_get(dict(documentType="A11", in_Domain=ENTSOE_EIC[z], out_Domain=se4, **per)))
                net = imp.sub(exp, fill_value=0) if imp is not None and exp is not None else (imp if imp is not None else -exp)
                out[z] = _hourly(net, hidx)
            except PermissionError:
                raise
            except Exception as e:
                err(f"A11 {z}", e)
        if not out:
            raise LookupError("no flows")
        return out
    q("flows", flows)
    q("out_gen", lambda: entsoe_outages_gen(now, today))

    def tx():
        rows, errs = entsoe_outages_tx(now, today)
        for e in errs:
            res["errors"].append(dict(q="A78", error=e))
        return rows
    q("out_tx", tx)

    def reservoirs():
        r, errs = entsoe_reservoirs(today)
        for e in errs:
            res["errors"].append(dict(q="A72", error=e))
        if not r:
            raise LookupError("no reservoir data")
        return r
    q("reservoirs", reservoirs)

    # ---- assemble SE4
    gen, fc = S4.get("gen") or {}, S4.get("fc") or {}
    wind, solar = gen.get("wind"), gen.get("solar")
    wind_fc, solar_fc = fc.get("wind"), fc.get("solar")
    load, load_fc = S4.get("load"), S4.get("load_fc")
    out = dict(t0=_ts(hidx[0]), n=len(hidx), unit="MW")
    ser = {}
    for k, s in (("wind", wind), ("wind_fc", wind_fc), ("solar", solar), ("solar_fc", solar_fc),
                 ("load", load), ("load_fc", load_fc)):
        if s is not None:
            ser[k] = _hourly(s, hidx)
    if gen:
        other = _sum([v for k, v in gen.items() if k not in ("wind", "solar") and v is not None])
        if other is not None:
            ser["other_gen"] = _hourly(other, hidx)
    if ser:
        out["series"] = ser
    if S4.get("flows"):
        out["flows"] = S4["flows"]
    if S4.get("load_week"):
        out["load_week"] = S4["load_week"]

    # value of wind: capture price vs baseload, computed from A44 prices x A75 actual / A69 forecast generation
    price = prices.get("SE4")
    if price is not None and (wind is not None or solar is not None):
        daily = []
        for i in range(30, 0, -1):
            d = today - dt.timedelta(days=i)
            a, b = _cet_bounds(d, d + dt.timedelta(days=1))
            w = _weighted(price, wind, a, b)
            s_ = _weighted(price, solar, a, b)
            pd_ = price[(price.index >= a) & (price.index < b)]
            base = rnd(pd_.mean()) if len(pd_) else None
            if base is None and not w:
                continue
            daily.append([d.isoformat(), base, w and w["cap"], w and w["mw"], s_ and s_["cap"], s_ and s_["mw"]])
        out["daily"] = daily
        cap = {}
        for key, n in (("d7", 7), ("d30", 30)):
            a, _ = _cet_bounds(today - dt.timedelta(days=n), today)
            b = _cet_bounds(today, today)[0]
            cw, cs = _weighted(price, wind, a, b), _weighted(price, solar, a, b)
            if cw or cs:
                cap[key] = dict(wind=cw, solar=cs)
        for key, d in (("today", today), ("tomorrow", today + dt.timedelta(days=1))):
            a, b = _cet_bounds(d, d + dt.timedelta(days=1))
            if len(price[(price.index >= a) & (price.index < b)]) and wind_fc is not None:
                cw = _weighted(price, wind_fc, a, b)
                if cw:
                    cap[key + "_fc"] = dict(wind=cw, date=d.isoformat())
        if cap:
            out["capture"] = cap
    # day-ahead wind forecast quality (A69 vs A75), last 7 complete days, hourly
    if wind is not None and wind_fc is not None:
        a, b = _cet_bounds(today - dt.timedelta(days=7), today)
        hw = wind.resample("1h").mean()
        hf = wind_fc.resample("1h").mean()
        hw, hf = hw[(hw.index >= a) & (hw.index < b)], hf.reindex(hw[(hw.index >= a) & (hw.index < b)].index)
        ok = hw.notna() & hf.notna()
        if ok.sum() >= 48:
            e = hf[ok] - hw[ok]
            out["wind_err"] = dict(mae=rnd(e.abs().mean(), 0), bias=rnd(e.mean(), 0), mean=rnd(hw[ok].mean(), 0),
                                   n=int(ok.sum()))
    if "out_gen" in S4:
        out["outages_gen"] = S4["out_gen"]
    if "out_tx" in S4:
        out["outages_tx"] = S4["out_tx"]

    # keep previous values for parts that failed this run
    pse4 = ((prev or {}).get("se4") or {})
    for k in ("series", "flows", "load_week", "daily", "capture", "wind_err", "outages_gen", "outages_tx"):
        if k not in out and pse4.get(k) is not None:
            out[k] = pse4[k]
            res["stale"].append(k)
    if "series" in res["stale"]:
        out["t0"], out["n"] = pse4.get("t0"), pse4.get("n")
    res["se4"] = out
    if S4.get("reservoirs"):
        res["reservoirs"] = S4["reservoirs"]
    elif (prev or {}).get("reservoirs"):
        res["reservoirs"] = prev["reservoirs"]
        res["stale"].append("reservoirs")
    res["asof"] = now.isoformat(timespec="seconds")
    if not ser and not S4:
        raise RuntimeError("all ENTSO-E queries failed")
    return res


def merge_spot_history(spot, prev, today):
    """Keep daily averages from earlier runs (so 7d/30d survive a source outage); newest run wins per day."""
    keep_from = (today - dt.timedelta(days=SPOT_KEEP_DAYS)).isoformat()
    for z in SPOT_ZONES:
        old = ((prev.get("zones") or {}).get(z) or {})
        cur = spot["zones"].get(z)
        if not old and not cur:
            continue
        if not cur:
            cur = spot["zones"][z] = dict(src=None, daily=[], days={}, stale=True)
        m = {d: v for d, v in old.get("daily", []) if v is not None}
        m.update({d: v for d, v in cur["daily"] if v is not None})
        cur["daily"] = [[d, m[d]] for d in sorted(m) if d >= keep_from]
        for d, v in (old.get("days") or {}).items():
            if d >= (today - dt.timedelta(days=1)).isoformat() and (d not in cur["days"] or (v.get("full") and not cur["days"][d].get("full"))):
                cur["days"][d] = v


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "power.json"))
    ap.add_argument("--eex-csv", default=None)
    ap.add_argument("--skip-spot", action="store_true")
    a = ap.parse_args()
    now = dt.datetime.now(UTC)
    today = now.astimezone(CET).date()
    prev = {}
    if os.path.exists(a.out):
        try:
            prev = json.load(open(a.out))
        except Exception:
            prev = {}
    out = dict(generated_utc=now.isoformat(timespec="seconds"), today=today.isoformat(), errors=[])

    def section(name, fn, *args):
        t0 = time.time()
        try:
            v = fn(*args)
            log(f"{name}: ok in {time.time() - t0:.0f}s")
            return v
        except Exception as e:
            log(f"{name}: FAILED {e}")
            out["errors"].append(dict(section=name, error=str(e)[:300]))
            return None

    eex = section("eex", build_eex, a.eex_csv)
    out["eex"] = eex
    hydro = section("hydro_no", build_hydro_no)
    hydro_se = section("hydro_se", build_hydro_se)
    out["hydro"] = dict(no=hydro, se=hydro_se)
    ent_px, ent_st = {}, []
    if _token():
        r = section("entsoe_prices", entsoe_prices, today)
        if r:
            ent_px, ent_st = r
    if a.skip_spot and prev.get("spot"):
        out["spot"], out["capture"] = prev.get("spot"), prev.get("capture")
    else:
        spot = section("spot", build_spot, today, ent_px, ent_st)
        if spot:
            merge_spot_history(spot, prev.get("spot") or {}, today)
            raw = spot.pop("raw")
            ent_px = {z: v[1] for z, v in raw.items()}
            spot["asof"] = now.isoformat(timespec="seconds")
            out["spot"] = spot
            out["capture"] = section("capture", build_capture, raw, today)
        else:
            out["spot"] = prev.get("spot")
            if out["spot"]:
                out["spot"]["stale"] = True
    out["svk"] = section("svk", build_svk, today)
    out["entsoe"] = section("entsoe", build_entsoe, today, now, ent_px, prev.get("entsoe") or {}) \
        or (dict(prev["entsoe"], stale=["all"]) if (prev.get("entsoe") or {}).get("enabled") else dict(enabled=False, reason="failed"))
    ok_parts = [k for k in ("eex",) if out.get(k)] + (["spot"] if out.get("spot") and out["spot"].get("zones") else []) \
        + (["hydro"] if hydro else [])
    if not ok_parts:
        log("nothing worked - not overwriting")
        return 2
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out + ".tmp", "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    os.replace(a.out + ".tmp", a.out)
    log(f"wrote {a.out} ({os.path.getsize(a.out) / 1024:.0f} KB): {', '.join(ok_parts)}; errors={len(out['errors'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
