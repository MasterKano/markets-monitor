#!/usr/bin/env python3
"""Build data/market.json for the Table page.

Pulls ~10 years of daily bars per symbol from Yahoo Finance's public chart endpoint
(curl_cffi browser impersonation, query1/query2 hosts, retries with exponential backoff),
falling back to yfinance. Computes price returns, volume averages/ratios, moving-average
distances and a 1-year sparkline. Real data only: anything missing is written as null
(shown as n/a on the page) and listed in "errors".

Usage: python scripts/build_data.py [--out data/market.json] [--only SYM,SYM]
       python scripts/build_data.py --intraday --out live/market.json
  --intraday: prices only (no quoteSummary fundamentals). Mkt cap / EV are scaled from the last full build
  (data/market.json) by the price change, converted at fresh FX. Used by .github/workflows/intraday.yml.
"""
import argparse, datetime as dt, json, math, os, random, sys, time
from zoneinfo import ZoneInfo

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from universe import GROUPS  # noqa: E402

ROOT = os.path.dirname(HERE)
UTC = dt.timezone.utc
GENEVA = ZoneInfo("Europe/Zurich")
HORIZONS = [("1W", dict(days=7)), ("1M", dict(months=1)), ("6M", dict(months=6)), ("1Y", dict(years=1)),
            ("2Y", dict(years=2)), ("3Y", dict(years=3)), ("5Y", dict(years=5)), ("10Y", dict(years=10))]
MAS = [10, 20, 50, 200]
VOLS = [5, 10, 20, 50]
MIN_OK_SHARE = 0.6   # refuse to overwrite the JSON if fewer than 60% of symbols fetched

try:
    from curl_cffi import requests as http
    SESSION = http.Session(impersonate="chrome")
except Exception:  # pragma: no cover
    import requests as http
    SESSION = http.Session()
    SESSION.headers["User-Agent"] = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ------------------------------------------------------------------ fetching
def fetch_chart(sym, years=10, tries=6):
    """Yahoo v8 chart endpoint -> (DataFrame[close, volume] indexed by date, meta)."""
    p2 = int(time.time()) + 86400
    p1 = int((dt.datetime.now(UTC) - pd.DateOffset(years=years, days=25)).timestamp())
    last_err = None
    for i in range(tries):
        host = ("query1", "query2")[i % 2]
        url = f"https://{host}.finance.yahoo.com/v8/finance/chart/{sym}"
        try:
            r = SESSION.get(url, params=dict(period1=p1, period2=p2, interval="1d", includePrePost="false",
                                             events="split"), timeout=30)
            if r.status_code == 404:
                raise LookupError(f"404 not found")
            if r.status_code in (429, 500, 502, 503, 504) or r.status_code >= 400:
                raise IOError(f"HTTP {r.status_code}")
            js = r.json()
            res = (js.get("chart") or {}).get("result")
            if not res:
                raise LookupError(str((js.get("chart") or {}).get("error"))[:120])
            res = res[0]
            ts = res.get("timestamp") or []
            q = res["indicators"]["quote"][0]
            if not ts:
                raise LookupError("no timestamps")
            meta = res.get("meta", {})
            tz = meta.get("exchangeTimezoneName") or "UTC"
            idx = pd.to_datetime(ts, unit="s", utc=True).tz_convert(tz)
            df = pd.DataFrame({"close": q.get("close"), "volume": q.get("volume")}, index=idx)
            return df, meta
        except LookupError as e:
            last_err = e
            if i >= 1:   # one retry on the other host, then give up (symbol genuinely missing)
                break
        except Exception as e:
            last_err = e
        wait = min(60, 2 ** (i + 1)) + random.uniform(0, 1.5)
        log(f"  {sym}: {last_err} -> retry in {wait:.1f}s")
        time.sleep(wait)
    raise RuntimeError(f"chart endpoint failed: {last_err}")


def fetch_yf(sym, years=10):
    import yfinance as yf
    t = yf.Ticker(sym)
    h = t.history(period=f"{years}y", interval="1d", auto_adjust=False, actions=False)
    if h is None or h.empty:
        raise RuntimeError("yfinance returned no rows")
    df = pd.DataFrame({"close": h["Close"], "volume": h.get("Volume")}, index=h.index)
    meta = {}
    try:
        meta = t.history_metadata or {}
    except Exception:
        pass
    return df, meta


def session_state(meta, now_ts=None):
    """'open' / 'pre' / 'post' / 'closed' from the chart meta's currentTradingPeriod at fetch time."""
    now_ts = now_ts or time.time()
    try:
        p = meta["currentTradingPeriod"]
        for k, lab in (("regular", "open"), ("pre", "pre"), ("post", "post")):
            if p[k]["start"] <= now_ts < p[k]["end"]:
                return lab
        return "closed"
    except Exception:
        return None


def fill_last_close(df, meta):
    """Yahoo quirk: the chart API often leaves the latest daily close blank (NaN) for Nordic/LSE tickers while
    meta.regularMarketPrice already holds that session's price. Fill (or append) the bar for the quote's
    regularMarketTime date so the latest close and 1D % are not a day behind. Returns (df, filled?)."""
    px, ts = meta.get("regularMarketPrice"), meta.get("regularMarketTime")
    try:
        px = float(px)
    except Exception:
        return df, False
    if not ts or not (px > 0) or math.isnan(px):
        return df, False
    tz = meta.get("exchangeTimezoneName") or "UTC"
    t = pd.Timestamp(int(ts), unit="s", tz="UTC").tz_convert(tz)
    d = t.date()
    df = df.copy()
    if len(df) and df.index.tz is None:
        df.index = df.index.tz_localize(tz)
    pos = [i for i, x in enumerate(df.index) if x.tz_convert(tz).date() == d]
    if pos:
        p = pos[-1]
        c = df.iloc[p, df.columns.get_loc("close")]
        if session_state(meta) == "open":
            # session in progress: the quote is the latest print; the daily bar can lag it
            df.iloc[p, df.columns.get_loc("close")] = px
            v, qv = df.iloc[p, df.columns.get_loc("volume")], meta.get("regularMarketVolume")
            if qv and (v is None or pd.isna(v) or float(qv) > v):
                df.iloc[p, df.columns.get_loc("volume")] = float(qv)
            return df, bool(c is None or pd.isna(c))
        if c is None or pd.isna(c):
            df.iloc[p, df.columns.get_loc("close")] = px
            v = df.iloc[p, df.columns.get_loc("volume")]
            if (v is None or pd.isna(v)) and meta.get("regularMarketVolume"):
                df.iloc[p, df.columns.get_loc("volume")] = float(meta["regularMarketVolume"])
            return df, True
        return df, False
    if len(df) and df.index[-1].tz_convert(tz).date() > d:
        return df, False
    vol = meta.get("regularMarketVolume")
    row = pd.DataFrame({"close": [px], "volume": [float(vol) if vol else float("nan")]}, index=pd.DatetimeIndex([t]))
    return pd.concat([df, row]).sort_index(), True


def fetch(sym):
    try:
        df, meta = fetch_chart(sym)
        src = "yahoo-chart"
    except Exception as e1:
        log(f"  {sym}: chart failed ({e1}); trying yfinance")
        try:
            df, meta = fetch_yf(sym)
            src = "yfinance"
        except Exception as e2:
            raise RuntimeError(f"{e1} | yfinance: {e2}")
    df, filled = fill_last_close(df, meta or {})
    if filled:
        meta = dict(meta, _last_from_quote=True)
    return clean(df), meta, src


def clean(df):
    df = df.copy()
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce")
    df = df[df["close"].notna() & (df["close"] > 0)]
    # one row per local trading date (Yahoo sometimes repeats the live bar)
    df["d"] = [t.date() for t in df.index]
    df = df.groupby("d").tail(1)
    df.index = pd.to_datetime(df.pop("d"))
    # drop isolated bad prints (e.g. GBp/GBP 100x glitches): >4x away from both neighbours' median
    if len(df) > 10:
        med = df["close"].rolling(7, center=True, min_periods=3).median()
        bad = (df["close"] / med > 4) | (df["close"] / med < 0.25)
        df = df[~bad]
    return df




# ------------------------------------------------------------------ fundamentals (mcap / EV) + FX -> EUR
MAJOR = {"GBp": "GBP", "ILA": "ILS", "ZAc": "ZAR", "KWF": "KWD"}  # Yahoo minor units -> FX major
FX_CCYS = ("USD", "NOK", "SEK", "DKK", "GBP", "CAD", "CHF", "JPY", "HKD", "AUD", "SGD", "NZD", "PLN", "CZK", "HUF", "TRY", "MXN", "BRL", "INR", "KRW", "TWD", "CNY", "ZAR", "ILS")


def yahoo_crumb(session):
    """Cookie + crumb for Yahoo quoteSummary (chart API does not need it)."""
    try:
        session.get("https://fc.yahoo.com", timeout=15)
        r = session.get("https://query1.finance.yahoo.com/v1/test/getcrumb", timeout=15)
        if r.status_code == 200 and r.text and " " not in r.text and "<" not in r.text:
            return r.text.strip()
    except Exception as e:
        log(f"crumb: {e}")
    return None


def _raw(d, key):
    if not d:
        return None
    v = d.get(key)
    if isinstance(v, dict):
        v = v.get("raw")
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def minor_unit_cap(mcap, ccy, px, shares):
    """Yahoo reports marketCap in the major unit (GBP) even when the quote is in a minor unit (GBp pence).
    Guard against the occasional small-cap record where the cap was computed from the pence price (100x too
    high): if cap / (shares x price in major units) is ~100, scale it back. -> (mcap, fixed?)"""
    if mcap is None or ccy not in MAJOR or not px or not shares:
        return mcap, False
    r = mcap / (shares * px / 100.0)
    if 50 < r < 200:
        return mcap / 100.0, True
    return mcap, False


def fetch_fundamentals(sym, crumb, tries=4):
    """Yahoo quoteSummary -> (marketCap, enterpriseValue, currency) or raise."""
    last_err = None
    for i in range(tries):
        host = ("query1", "query2")[i % 2]
        url = f"https://{host}.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
        try:
            params = dict(modules="price,defaultKeyStatistics,summaryDetail,financialData")
            if crumb:
                params["crumb"] = crumb
            r = SESSION.get(url, params=params, timeout=25)
            if r.status_code in (401, 403) and i == 0:
                # refresh crumb once
                crumb = yahoo_crumb(SESSION)
                params["crumb"] = crumb
                r = SESSION.get(url, params=params, timeout=25)
            if r.status_code in (429, 500, 502, 503, 504) or r.status_code >= 400:
                raise IOError(f"HTTP {r.status_code}")
            res = ((r.json().get("quoteSummary") or {}).get("result") or [None])[0]
            if not res:
                raise LookupError(str((r.json().get("quoteSummary") or {}).get("error"))[:120])
            price = res.get("price") or {}
            ks = res.get("defaultKeyStatistics") or {}
            sd = res.get("summaryDetail") or {}
            mcap = _raw(price, "marketCap") or _raw(sd, "marketCap")
            ev = _raw(ks, "enterpriseValue")
            ccy = price.get("currency") or sd.get("currency")
            fccy = (res.get("financialData") or {}).get("financialCurrency")
            mcap, fixed = minor_unit_cap(mcap, ccy, _raw(price, "regularMarketPrice"),
                                         _raw(ks, "sharesOutstanding") or _raw(ks, "impliedSharesOutstanding"))
            if fixed:
                log(f"  {sym}: marketCap looked like {ccy} (minor unit) x shares; scaled /100")
                ev = None          # Yahoo EV shares the same basis; rebuild from components instead
            return mcap, ev, ccy, fccy
        except LookupError as e:
            last_err = e
            break
        except Exception as e:
            last_err = e
            time.sleep(min(20, 2 ** (i + 1)) + random.uniform(0, 0.8))
    raise RuntimeError(f"fundamentals failed: {last_err}")


BAL_FIELDS = ("TotalDebt", "CashCashEquivalentsAndShortTermInvestments", "CashAndCashEquivalents", "NetDebt",
              "MinorityInterest")


def parse_timeseries(js):
    """fundamentals-timeseries JSON -> ({type: {asOfDate: value}}, dominant currency)."""
    out, ccys = {}, {}
    for it in ((js or {}).get("timeseries") or {}).get("result") or []:
        t = ((it.get("meta") or {}).get("type") or [None])[0]
        pts = [x for x in (it.get(t) or []) if x and x.get("asOfDate") and _raw(x, "reportedValue") is not None]
        if not t or not pts:
            continue
        out[t] = {x["asOfDate"]: _raw(x, "reportedValue") for x in pts}
        for x in pts:
            if x.get("currencyCode"):
                ccys[x["currencyCode"]] = ccys.get(x["currencyCode"], 0) + 1
    return out, (max(ccys, key=ccys.get) if ccys else None)


def ts_latest(ts, field):
    """Most recent reported point across quarterly and annual series -> (value, date)."""
    best = (None, None)
    for p in ("annual", "quarterly"):          # quarterly wins ties
        s = ts.get(p + field) or {}
        if s:
            d = max(s)
            if best[1] is None or d >= best[1]:
                best = (s[d], d)
    return best


def balance_from_ts(ts):
    """Latest net debt (total debt - cash & ST investments; Yahoo NetDebt fallback) and minority interest."""
    debt, d = ts_latest(ts, "TotalDebt")
    cash, _ = ts_latest(ts, "CashCashEquivalentsAndShortTermInvestments")
    if cash is None:
        cash, _ = ts_latest(ts, "CashAndCashEquivalents")
    nd = (debt - cash) if debt is not None and cash is not None else ts_latest(ts, "NetDebt")[0]
    if nd is None and debt is None and cash is not None:
        # no debt line at all (Yahoo omits TotalDebt for debt-free small caps): net cash = -cash
        nd, d = -cash, ts_latest(ts, "CashCashEquivalentsAndShortTermInvestments")[1] or ts_latest(ts, "CashAndCashEquivalents")[1]
    mi, _ = ts_latest(ts, "MinorityInterest")
    return dict(nd=nd, mi=mi, asof=d)


def fetch_balance(sym, crumb, tries=3):
    """Balance-sheet components for EV from Yahoo fundamentals-timeseries -> (dict, currency)."""
    types = ",".join(p + f for p in ("annual", "quarterly") for f in BAL_FIELDS)
    last_err = None
    for i in range(tries):
        host = ("query2", "query1")[i % 2]
        try:
            params = dict(type=types, period1=int(time.time()) - 3 * 365 * 86400, period2=int(time.time()) + 86400)
            if crumb:
                params["crumb"] = crumb
            r = SESSION.get(f"https://{host}.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{sym}",
                            params=params, timeout=25)
            if r.status_code >= 400:
                raise IOError(f"HTTP {r.status_code}")
            ts, ccy = parse_timeseries(r.json())
            return balance_from_ts(ts), ccy
        except Exception as e:
            last_err = e
            time.sleep(min(10, 2 ** (i + 1)) + random.uniform(0, 0.5))
    raise RuntimeError(f"balance failed: {last_err}")


def fx_conv(v, src, dst, fx_table):
    """Convert v between currencies (minor units mapped to major) via the EUR-cross table."""
    if v is None or not src or not dst:
        return None
    src, dst = MAJOR.get(src, src), MAJOR.get(dst, dst)
    if src == dst:
        return v
    a, b = (fx_table.get(src) or {}).get("rate"), (fx_table.get(dst) or {}).get("rate")
    return v / a * b if a and b else None


def calc_ev(mcap, pccy, bal, fccy, yahoo_ev, fx_table):
    """EV in trading currency = market cap + net debt (+ minorities), the reporting-currency balance sheet converted
    at the current FX cross. Yahoo's enterpriseValue mixes currencies for cross-currency reporters, so it is used
    only when the components are missing and listing and reporting currency agree. -> (ev, source)."""
    pmaj = MAJOR.get(pccy, pccy)
    fccy = fccy or pmaj
    if mcap is not None and bal and bal.get("nd") is not None:
        adj = fx_conv(bal["nd"] + (bal.get("mi") or 0), fccy, pmaj, fx_table)
        if adj is not None:
            return mcap + adj, "calc"
    if yahoo_ev is not None and MAJOR.get(fccy, fccy) == pmaj:
        return yahoo_ev, "yahoo"
    return None, None


def fetch_fx_yahoo(ccy):
    """Units of `ccy` per 1 EUR via Yahoo EUR{CCY}=X. Returns (rate, asof_iso) or None."""
    if ccy == "EUR":
        return 1.0, dt.datetime.now(UTC).date().isoformat()
    pair = f"EUR{ccy}=X"
    try:
        df, meta = fetch_chart(pair, years=1, tries=3)
        px = meta.get("regularMarketPrice")
        if px is None and not df.empty:
            px = float(df["close"].iloc[-1])
        if px is None or not (px > 0):
            return None
        ts = meta.get("regularMarketTime")
        asof = (dt.datetime.fromtimestamp(ts, UTC).date().isoformat() if ts
                else (df.index[-1].strftime("%Y-%m-%d") if len(df) else None))
        return float(px), asof
    except Exception as e:
        log(f"  FX {pair}: Yahoo failed ({e})")
        return None


def fetch_fx_ecb(ccy):
    """ECB SDW mid: units of `ccy` per 1 EUR. Returns (rate, asof_iso) or None."""
    if ccy == "EUR":
        return 1.0, dt.datetime.now(UTC).date().isoformat()
    url = f"https://data-api.ecb.europa.eu/service/data/EXR/D.{ccy}.EUR.SP00.A"
    try:
        r = SESSION.get(url, params={"lastNObservations": 5, "format": "jsondata"},
                        timeout=20, headers={"Accept": "application/json"})
        if r.status_code >= 400:
            raise IOError(f"HTTP {r.status_code}")
        js = r.json()
        obs = js["dataSets"][0]["series"]["0:0:0:0:0"]["observations"]
        dims = js["structure"]["dimensions"]["observation"][0]["values"]
        # pick latest non-null
        best = None
        for k, v in obs.items():
            if v and v[0] is not None:
                best = (float(v[0]), dims[int(k)]["id"])
        return best
    except Exception as e:
        log(f"  FX {ccy}: ECB failed ({e})")
        return None


def build_fx_table(needed):
    """Map ISO currency -> {rate, asof, src} where rate = units of ccy per 1 EUR."""
    out = {"EUR": dict(rate=1.0, asof=dt.datetime.now(UTC).date().isoformat(), src="identity")}
    for ccy in sorted(needed):
        if ccy == "EUR":
            continue
        got = fetch_fx_yahoo(ccy)
        if got:
            out[ccy] = dict(rate=rnd(got[0], 6), asof=got[1], src="yahoo")
            continue
        got = fetch_fx_ecb(ccy)
        if got:
            out[ccy] = dict(rate=rnd(got[0], 6), asof=got[1], src="ecb")
        else:
            log(f"  FX {ccy}: unavailable")
        time.sleep(0.15)
    return out


def to_eur(val, ccy, fx_table):
    if val is None:
        return None
    major = MAJOR.get(ccy, ccy) or "EUR"
    info = fx_table.get(major)
    if not info or not info.get("rate"):
        return None
    return rnd(float(val) / float(info["rate"]), 0)  # whole euros


# ------------------------------------------------------------------ analytics
def rnd(x, n=4):
    if x is None:
        return None
    try:
        x = float(x)
    except Exception:
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, n)


def sig(x, s=5):
    if x is None or x == 0:
        return x
    return float(f"{x:.{s}g}")


def base_on_or_before(c, when):
    s = c[c.index <= when]
    return None if s.empty else float(s.iloc[-1])


def analyse(spec, df, meta, src, now, fund=None, fx_table=None):
    c, v = df["close"], df["volume"]
    last_date = c.index[-1]
    px = float(c.iloc[-1])
    out = dict(sym=spec["sym"], name=spec["name"], tv=spec.get("tv"), kind=spec.get("kind", "equity"),
               note=spec.get("note"), ccy=meta.get("currency"), exch=meta.get("exchangeName"),
               src=src, bar_date=last_date.strftime("%Y-%m-%d"), sessions=int(len(c)),
               first_date=c.index[0].strftime("%Y-%m-%d"))
    # live / partial session: fetched while the instrument's regular session was open
    try:
        reg = meta["currentTradingPeriod"]["regular"]
        today_ex = now.astimezone(ZoneInfo(meta.get("exchangeTimezoneName") or "UTC")).date()
        out["partial"] = bool(reg["start"] <= now.timestamp() < reg["end"]) and last_date.date() == today_ex
    except Exception:
        out["partial"] = None
    out["state"] = session_state(meta, now.timestamp())   # open / pre / post / closed at fetch time
    out["market_time"] = (dt.datetime.fromtimestamp(meta["regularMarketTime"], UTC).isoformat()
                          if meta.get("regularMarketTime") else None)
    out["px"] = rnd(px, 6)
    prev = float(c.iloc[-2]) if len(c) >= 2 else None
    # equities/ETFs: previous close per Yahoo's quote (regularMarketChangePercent) guards against a blank prior
    # daily bar (Nordic/LSE quirk). FX/futures keep the daily-bar previous close (Yahoo's quote uses other cut-offs).
    rmp, rcp = meta.get("regularMarketPrice"), meta.get("regularMarketChangePercent")
    if spec.get("kind", "equity") in ("equity", "etf") and isinstance(rmp, (int, float)) and isinstance(rcp, (int, float)) and rcp > -100 and abs(px - rmp) <= 1e-6 * abs(rmp):
        q_prev = rmp / (1 + rcp / 100)
        if prev is None or abs(q_prev / prev - 1) > 0.002:
            prev = q_prev
    out["prev_close"] = rnd(prev, 6)
    out["chg"] = rnd(px - prev, 6) if prev else None
    pct = {"1D": rnd((px / prev - 1) * 100, 3) if prev else None}
    for key, off in HORIZONS:
        target = last_date - pd.DateOffset(**off)
        if c.index[0] > target:
            pct[key] = None            # not enough history: never extrapolate
            continue
        b = base_on_or_before(c, target)
        pct[key] = rnd((px / b - 1) * 100, 3) if b else None
    ye = pd.Timestamp(year=last_date.year - 1, month=12, day=31)
    b = base_on_or_before(c, ye) if c.index[0] <= ye else None
    pct["YTD"] = rnd((px / b - 1) * 100, 3) if b else None
    out["pct"] = pct
    if spec.get("kind") == "yield":
        # yields: also express changes in basis points (Yahoo quotes ^TNX etc. in percent)
        bp = {"1D": rnd((px - prev) * 100, 1) if prev else None}
        for key, off in HORIZONS:
            target = last_date - pd.DateOffset(**off)
            b = base_on_or_before(c, target) if c.index[0] <= target else None
            bp[key] = rnd((px - b) * 100, 1) if b else None
        b = base_on_or_before(c, ye) if c.index[0] <= ye else None
        bp["YTD"] = rnd((px - b) * 100, 1) if b else None
        out["bp"] = bp

    # volume: last bar vs average of the N sessions BEFORE it
    vol = {}
    vv = v.fillna(0)
    has_vol = bool((vv.tail(60) > 0).sum() >= 10)
    if has_vol and vv.iloc[-1] > 0:
        last_v = float(vv.iloc[-1])
        vol["last"] = int(last_v)
        prior = vv.iloc[:-1]
        prior = prior[prior > 0]
        for n in VOLS:
            if len(prior) >= n:
                a = float(prior.tail(n).mean())
                vol[f"a{n}"] = int(round(a))
                vol[f"r{n}"] = rnd(last_v / a, 3) if a > 0 else None
            else:
                vol[f"a{n}"] = vol[f"r{n}"] = None
    else:
        vol = dict(last=None, **{f"a{n}": None for n in VOLS}, **{f"r{n}": None for n in VOLS})
        if has_vol and vv.iloc[-1] == 0:
            vol["note"] = "no volume on latest bar yet"
    out["vol"] = vol

    ma = {}
    for n in MAS:
        if len(c) >= n:
            m = float(c.tail(n).mean())
            ma[str(n)] = dict(v=rnd(m, 6), pct=rnd((px / m - 1) * 100, 3))
            if spec.get("kind") == "yield":
                ma[str(n)]["bp"] = rnd((px - m) * 100, 1)
        else:
            ma[str(n)] = None
    out["ma"] = ma

    s = c[c.index > last_date - pd.DateOffset(years=1)]
    step = max(1, len(s) // 90)
    pts = list(s.iloc[::-1][::step][::-1])     # keep the latest point exactly
    out["spark"] = [sig(x) for x in pts]
    out["spark_from"] = s.index[0].strftime("%Y-%m-%d") if len(s) else None
    out["roll"] = spec.get("kind") == "future"

    # Market cap / enterprise value (equities & ETFs), converted to EUR when FX is known
    kind = spec.get("kind", "equity")
    out["mcap"] = out["mcap_eur"] = out["ev"] = out["ev_eur"] = None
    out["mcap_ccy"] = None
    if meta.get("_last_from_quote"):
        out["last_from_quote"] = True     # latest close taken from the quote (chart bar was blank / missing)
    if fund and kind in ("equity", "etf"):
        mcap, ev_y, fcy, fin_ccy, bal = (list(fund) + [None, None])[:5]
        ccy = fcy or out.get("ccy")
        ev, ev_src = ev_y, ("yahoo" if ev_y is not None else None)
        if kind == "equity" and fx_table:
            ev, ev_src = calc_ev(mcap, ccy, bal, fin_ccy, ev_y, fx_table)
        out["mcap"] = sig(mcap, 6) if mcap is not None else None
        out["ev"] = sig(ev, 6) if ev is not None else None
        out["ev_src"] = ev_src
        out["mcap_ccy"] = ccy
        if fx_table:
            out["mcap_eur"] = to_eur(mcap, ccy, fx_table)
            out["ev_eur"] = to_eur(ev, ccy, fx_table)
    return out


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "market.json"))
    ap.add_argument("--only", default="")
    ap.add_argument("--sleep", type=float, default=0.35)
    ap.add_argument("--intraday", action="store_true", help="prices only; scale mcap/EV from data/market.json")
    a = ap.parse_args()
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    now = dt.datetime.now(UTC)

    specs = {}
    for g in GROUPS:
        for sec in g["sections"]:
            for r in sec["rows"]:
                specs.setdefault(r["sym"], r)
    syms = [s for s in specs if not only or s in only]
    cache, errors = {}, []
    t0 = time.time()
    for i, sym in enumerate(syms):
        try:
            df, meta, src = fetch(sym)
            if df.empty:
                raise RuntimeError("no valid closes")
            cache[sym] = (df, meta, src)
            log(f"[{i+1}/{len(syms)}] {sym}: {len(df)} bars to {df.index[-1].date()} via {src}")
        except Exception as e:
            errors.append(dict(sym=sym, error=str(e)[:300]))
            log(f"[{i+1}/{len(syms)}] {sym}: FAILED {e}")
        time.sleep(a.sleep + random.uniform(0, 0.25))

    ok_share = len(cache) / max(1, len(syms))
    if ok_share < MIN_OK_SHARE:
        log(f"Only {len(cache)}/{len(syms)} symbols fetched - not overwriting {a.out}")
        return 2

    # Fundamentals (mcap / EV) for equities & ETFs (intraday: reuse the last full build instead)
    base_rows, base_meta = {}, {}
    if a.intraday:
        try:
            with open(os.path.join(ROOT, "data", "market.json")) as f:
                base = json.load(f)
            base_meta = dict(utc=base.get("fundamentals_utc") or base.get("generated_utc"))
            base_rows = {r["sym"]: r for g in base["groups"] for sec in g["sections"] for r in sec["rows"]}
        except Exception as e:
            log(f"intraday: no base market.json ({e})")
    crumb = None if a.intraday else yahoo_crumb(SESSION)
    funds = {}
    fund_kinds = {"equity", "etf"}
    fund_syms = [s for s in syms if specs[s].get("kind", "equity") in fund_kinds and s in cache and not a.intraday]
    for i, sym in enumerate(fund_syms):
        try:
            mcap, ev, ccy, fccy = fetch_fundamentals(sym, crumb)
            bal = None
            if specs[sym].get("kind", "equity") == "equity":
                try:
                    bal, ts_ccy = fetch_balance(sym, crumb)
                    fccy = ts_ccy or fccy
                except Exception as e:
                    log(f"  balance {sym}: {e}")
            funds[sym] = (mcap, ev, ccy, fccy, bal)
            log(f"  fund [{i+1}/{len(fund_syms)}] {sym}: mcap={mcap} ev_yahoo={ev} {ccy}/{fccy} nd={bal and bal.get('nd')}")
        except Exception as e:
            log(f"  fund [{i+1}/{len(fund_syms)}] {sym}: {e}")
        time.sleep(a.sleep * 0.5 + random.uniform(0, 0.15))

    # FX -> EUR (Yahoo, ECB mid fallback)
    needed = {MAJOR.get(r.get("mcap_ccy"), r.get("mcap_ccy")) for r in base_rows.values() if r.get("mcap_ccy")}
    for sym, trip in funds.items():
        ccy = trip[2] or (cache[sym][1] or {}).get("currency")
        for c in (ccy, trip[3]):
            if c:
                needed.add(MAJOR.get(c, c))
    for sym, (df, meta, src) in cache.items():
        ccy = meta.get("currency")
        if ccy:
            needed.add(MAJOR.get(ccy, ccy))
    needed.discard(None)
    fx_table = build_fx_table(needed)
    log(f"FX table: { {k: v['rate'] for k, v in fx_table.items()} }")

    groups = []
    for g in GROUPS:
        gs = dict(id=g["id"], label=g["label"], sections=[])
        for sec in g["sections"]:
            rows = []
            for spec in sec["rows"]:
                if only and spec["sym"] not in only:
                    continue
                if spec["sym"] in cache:
                    df, meta, src = cache[spec["sym"]]
                    try:
                        row = analyse(spec, df, meta, src, now, fund=funds.get(spec['sym']), fx_table=fx_table)
                        b = base_rows.get(spec["sym"]) or {}
                        if a.intraday and b.get("px") and row.get("px") and b.get("ccy") == row.get("ccy"):
                            # mcap scales with price; EV = mcap + (unchanged) net debt
                            k = row["px"] / b["px"]
                            for f in ("mcap_ccy", "ev_src"):
                                row[f] = b.get(f)
                            if b.get("mcap") is not None:
                                row["mcap"] = sig(b["mcap"] * k, 6)
                                row["mcap_eur"] = to_eur(row["mcap"], row["mcap_ccy"], fx_table)
                                if b.get("ev") is not None:
                                    row["ev"] = sig(b["ev"] + b["mcap"] * (k - 1), 6)
                                    row["ev_eur"] = to_eur(row["ev"], row["mcap_ccy"], fx_table)
                    except Exception as e:
                        row = dict(sym=spec["sym"], name=spec["name"], tv=spec.get("tv"), kind=spec.get("kind"),
                                   note=spec.get("note"), error=f"analysis failed: {e}"[:200])
                        errors.append(dict(sym=spec["sym"], error=row["error"]))
                elif a.intraday and spec["sym"] in base_rows and not base_rows[spec["sym"]].get("error"):
                    row = dict(base_rows[spec["sym"]], stale=True)   # keep the last full-build values
                else:
                    err = next((e["error"] for e in errors if e["sym"] == spec["sym"]), "not fetched")
                    row = dict(sym=spec["sym"], name=spec["name"], tv=spec.get("tv"), kind=spec.get("kind"),
                               note=spec.get("note"), error=err)
                rows.append(row)
            gs["sections"].append(dict(label=sec.get("label"), note=sec.get("note"), rows=rows))
        groups.append(gs)

    fx_asof = sorted({v["asof"] for v in fx_table.values() if v.get("asof")})
    out = dict(
        generated_utc=now.isoformat(timespec="seconds"),
        generated_geneva=now.astimezone(GENEVA).isoformat(timespec="seconds"),
        mode="intraday" if a.intraday else "full",
        fundamentals_utc=base_meta.get("utc") if a.intraday else now.isoformat(timespec="seconds"),
        source="Yahoo Finance daily bars (chart API; yfinance fallback). Price returns, not total return. Market cap / EV from Yahoo quoteSummary, converted to EUR.",
        method=dict(
            returns="Last close vs last close on/before the same calendar date N periods earlier; YTD vs prior year-end close; n/a if history is shorter.",
            volume="Last session volume vs average of the N sessions before it.",
            ma="Simple moving average of daily closes incl. the latest bar; % = price / MA - 1.",
            futures="Continuous front-month futures: long-horizon returns (esp. 10Y) include roll effects.",
            mcap_ev="Yahoo marketCap. Equity EV = market cap + net debt (latest total debt minus cash & short-term investments) + minority interest, reporting-currency balance sheet converted at current FX (same as the company panel); Yahoo enterpriseValue only when components are missing (and for ETFs). Converted to EUR via Yahoo EUR{CCY}=X (ECB SDW mid fallback). London quotes are in pence (GBp); Yahoo market cap is in GBP (checked against shares x price, a 100x pence slip is scaled back).",
            last_close="When Yahoo's chart API leaves the latest daily close blank (common for Nordic/LSE tickers), the quote's regularMarketPrice for that session is used (last_from_quote).",
            prices="Latest price = Yahoo quote (regularMarketPrice / regularMarketTime; typically ~15 min delayed, not live); 1D vs the previous session's close. While a session is open the latest daily bar (and its volume) is today so far.",
        ),
        fx_eur=fx_table,
        fx_asof=fx_asof[-1] if fx_asof else None,
        symbols=len(syms), fetched=len(cache), seconds=round(time.time() - t0, 1),
        groups=groups, errors=errors,
    )
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    os.replace(tmp, a.out)
    log(f"wrote {a.out}: {len(cache)}/{len(syms)} symbols, {len(errors)} errors, {out['seconds']}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
