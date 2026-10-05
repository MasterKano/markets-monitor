#!/usr/bin/env python3
"""Build data/power.json for the Nordic Power tab.

Sources (all free, no API key; real data only, missing values are written as null and shown as n/a):
  * EEX daily settlements: the public CSV kept by MasterKano/scrape (master/eex_master.csv), read from
    raw.githubusercontent.com. Power base futures (Nordic system + zonal, DE and other EU areas),
    TTF gas, EUA, API2 coal, Guarantees of Origin (wind). History starts 1 Sep 2026 (no backfill).
  * Day-ahead prices per bidding zone: Fraunhofer ISE Energy-Charts API (CC BY 4.0). If a zone fails,
    Energinet's Energi Data Service (DayAheadPrices) is used for the zones it publishes (DK1, DK2, NO2,
    SE3, SE4, DE), then spot-hinta.fi (today/tomorrow only). Daily averages from earlier runs are kept.
  * Generation per bidding zone (Energy-Charts public_power, when available) for computed capture prices.
  * Hydro: NVE magasinstatistikk API (Norway, weekly). Sweden: Energiföretagen weekly PDF snapshot.

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
SPOT_ZONES = ["NO1", "NO2", "NO3", "NO4", "NO5", "SE1", "SE2", "SE3", "SE4", "FI", "DK1", "DK2", "DE-LU"]
NORDIC_SPOT = SPOT_ZONES[:-1]
EDS_MAP = {"DK1": "DK1", "DK2": "DK2", "NO2": "NO2", "SE3": "SE3", "SE4": "SE4", "DE-LU": "DE"}
MON = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


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


def build_spot(today):
    start = (today - dt.timedelta(days=32)).isoformat()
    end = (today + dt.timedelta(days=1)).isoformat()
    zones, status, raw = {}, [], {}
    for i, z in enumerate(SPOT_ZONES):
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
            if i == 1 and not any(x["ok"] for x in status):
                log("Energy-Charts unavailable for the first two zones - skipping the rest")
                for z2 in SPOT_ZONES[2:]:
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
        if z in raw or z == "DE-LU":
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
        if z not in raw_prices or raw_prices[z][0] != "Energy-Charts":
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


def merge_spot_history(spot, prev, today):
    """Keep daily averages from earlier runs (so 7d/30d survive a source outage); newest run wins per day."""
    keep_from = (today - dt.timedelta(days=40)).isoformat()
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
    if a.skip_spot and prev.get("spot"):
        out["spot"], out["capture"] = prev.get("spot"), prev.get("capture")
    else:
        spot = section("spot", build_spot, today)
        if spot:
            merge_spot_history(spot, prev.get("spot") or {}, today)
            raw = spot.pop("raw")
            spot["asof"] = now.isoformat(timespec="seconds")
            out["spot"] = spot
            out["capture"] = section("capture", build_capture, raw, today)
        else:
            out["spot"] = None
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
