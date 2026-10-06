#!/usr/bin/env python3
"""Build data/companies.json: per-equity fundamentals for the company panel (and later compare views).

Sources (Yahoo Finance, public endpoints, cookie + crumb):
  * v10 quoteSummary: price, summaryDetail, defaultKeyStatistics, financialData, earningsTrend,
    calendarEvents, recommendationTrend, assetProfile (sector / industry / country / website / summary only)
  * ws/fundamentals-timeseries: annual + quarterly + trailing revenue, EBITDA, net income, debt, cash,
    free cash flow, equity (Yahoo has stripped most statement modules from quoteSummary)

Real data only: missing values are null. Per-symbol failures never break the build; the previous entry
(from the existing companies.json) is kept and flagged "stale". Keyed by Yahoo symbol.

Usage: python scripts/build_companies.py [--out data/companies.json] [--only SYM,SYM] [--extra SYM,SYM]
"""
import argparse, datetime as dt, json, math, os, random, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from universe import GROUPS  # noqa: E402
from build_data import SESSION, MAJOR, yahoo_crumb, build_fx_table, log  # noqa: E402

ROOT = os.path.dirname(HERE)
UTC = dt.timezone.utc
QS_MODULES = ("price,summaryDetail,defaultKeyStatistics,financialData,earningsTrend,calendarEvents,"
              "recommendationTrend,assetProfile")
TS_FIELDS = ("TotalRevenue", "EBITDA", "NormalizedEBITDA", "NetIncomeCommonStockholders", "NetIncome",
             "TotalDebt", "CashCashEquivalentsAndShortTermInvestments", "CashAndCashEquivalents", "NetDebt",
             "FreeCashFlow", "OperatingCashFlow", "CapitalExpenditure", "StockholdersEquity", "MinorityInterest",
             "DilutedEPS")
N_ANNUAL, N_QUARTER = 4, 4
MIN_OK_SHARE = 0.5   # keep the old file if fewer than half the symbols fetched (e.g. Yahoo outage)


# ------------------------------------------------------------------ helpers
def num(x):
    if isinstance(x, dict):
        x = x.get("raw")
    try:
        x = float(x)
    except Exception:
        return None
    return None if math.isnan(x) or math.isinf(x) else x


def sig(x, s=6):
    x = num(x)
    if x is None:
        return None
    if x == 0:
        return 0
    v = float(f"{x:.{s}g}")
    return int(v) if abs(v) >= 1e5 and v == int(v) else v


def rnd(x, n=2):
    x = num(x)
    return None if x is None else round(x, n)


def iso_date(v):
    t = num(v)
    if t is None:
        return None
    try:
        return dt.datetime.fromtimestamp(t, UTC).date().isoformat()
    except Exception:
        return None


def get(url, params, crumb, tries=4):
    last = None
    for i in range(tries):
        host = ("query2", "query1")[i % 2]
        try:
            p = dict(params)
            if crumb[0]:
                p["crumb"] = crumb[0]
            r = SESSION.get(url.format(host=host), params=p, timeout=25)
            if r.status_code in (401, 403):
                crumb[0] = yahoo_crumb(SESSION)
                raise IOError(f"HTTP {r.status_code} (crumb refreshed)")
            if r.status_code == 404:
                return r.json() if "json" in r.headers.get("content-type", "") else None
            if r.status_code >= 400:
                raise IOError(f"HTTP {r.status_code}")
            return r.json()
        except Exception as e:
            last = e
            time.sleep(min(20, 2 ** (i + 1)) + random.uniform(0, 1))
    raise RuntimeError(str(last)[:200])


def fetch_summary(sym, crumb):
    js = get("https://{host}.finance.yahoo.com/v10/finance/quoteSummary/" + sym, dict(modules=QS_MODULES), crumb)
    res = ((js or {}).get("quoteSummary") or {}).get("result") or []
    if not res:
        raise LookupError(str(((js or {}).get("quoteSummary") or {}).get("error"))[:160])
    r = res[0]
    p = r.get("price") or {}
    if num(p.get("regularMarketPrice")) is None and num(p.get("marketCap")) is None:
        raise LookupError("no quote data (unknown or delisted symbol?)")
    return r


def fetch_timeseries(sym, crumb):
    types = ",".join(p + f for p in ("annual", "quarterly", "trailing") for f in TS_FIELDS)
    js = get("https://{host}.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/" + sym,
             dict(type=types, period1=1420070400, period2=int(time.time()) + 86400), crumb)
    out, ccys = {}, {}
    for it in ((js or {}).get("timeseries") or {}).get("result") or []:
        t = ((it.get("meta") or {}).get("type") or [None])[0]
        pts = [x for x in (it.get(t) or []) if x and x.get("asOfDate") and num((x.get("reportedValue") or {}).get("raw")) is not None]
        if not t or not pts:
            continue
        out[t] = {x["asOfDate"]: num(x["reportedValue"]["raw"]) for x in pts}
        for x in pts:
            if x.get("currencyCode"):
                ccys[x["currencyCode"]] = ccys.get(x["currencyCode"], 0) + 1
    ccy = max(ccys, key=ccys.get) if ccys else None
    return out, ccy


# ------------------------------------------------------------------ shaping
def series(ts, period, n):
    """Return list of {d, rev, ebitda, ni, nd, fcf, eq} for the last n period ends (oldest first)."""
    pre = period
    pick = lambda f: ts.get(pre + f) or {}
    dates = set()
    for f in ("TotalRevenue", "EBITDA", "NetIncomeCommonStockholders", "NetIncome", "FreeCashFlow", "TotalDebt", "NetDebt"):
        dates |= set(pick(f))
    rows = []
    for d in sorted(dates)[-n:]:
        g = lambda f: pick(f).get(d)
        debt, cash = g("TotalDebt"), g("CashCashEquivalentsAndShortTermInvestments")
        if cash is None:
            cash = g("CashAndCashEquivalents")
        nd = (debt - cash) if debt is not None and cash is not None else g("NetDebt")
        fcf = g("FreeCashFlow")
        if fcf is None and g("OperatingCashFlow") is not None and g("CapitalExpenditure") is not None:
            fcf = g("OperatingCashFlow") + g("CapitalExpenditure")
        ebitda = g("EBITDA")
        if ebitda is None:
            ebitda = g("NormalizedEBITDA")
        ni = g("NetIncomeCommonStockholders")
        if ni is None:
            ni = g("NetIncome")
        row = dict(d=d, rev=sig(g("TotalRevenue")), ebitda=sig(ebitda), ni=sig(ni), nd=sig(nd), fcf=sig(fcf))
        if any(row[k] is not None for k in ("rev", "ebitda", "ni", "nd", "fcf")):
            rows.append(row)
    return rows


def ttm(ts, quarterly):
    """Trailing-twelve-month flows (Yahoo 'trailing' series, else sum of the last 4 quarters)."""
    out = {}
    for key, fields in (("rev", ("TotalRevenue",)), ("ebitda", ("EBITDA", "NormalizedEBITDA")),
                        ("ni", ("NetIncomeCommonStockholders", "NetIncome")), ("fcf", ("FreeCashFlow",))):
        v, d = None, None
        for f in fields:
            s = ts.get("trailing" + f) or {}
            if s:
                d = max(s)
                v = s[d]
                break
        if v is None and len(quarterly) >= 4 and all(q.get(key) is not None for q in quarterly[-4:]):
            v, d = sum(q[key] for q in quarterly[-4:]), quarterly[-1]["d"]
        out[key] = sig(v)
        if d:
            out["d"] = max(out.get("d") or d, d)
    return out


def latest(ts, field):
    """Most recent reported point across quarterly and annual series."""
    best = (None, None)
    for p in ("annual", "quarterly"):          # quarterly wins ties
        s = ts.get(p + field) or {}
        if s:
            d = max(s)
            if best[1] is None or d >= best[1]:
                best = (s[d], d)
    return best


def first_sentences(text, limit=320):
    if not text:
        return None
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[a-z0-9\)])\.\s+(?=[A-Z])", text)
    out = ""
    for p in parts:
        p = p.rstrip(".") + "."
        if out and len(out) + len(p) + 1 > limit:
            break
        out = (out + " " + p).strip()
        if len(out) >= limit * 0.6:
            break
    if len(out) > limit + 80:
        out = out[:limit].rsplit(" ", 1)[0] + "…"
    return out


class FX:
    def __init__(self, table):
        self.t = table

    def rate(self, ccy):
        info = self.t.get(MAJOR.get(ccy, ccy) or "")
        return info.get("rate") if info else None

    def conv(self, v, src, dst):
        """Convert v from major-unit currency src to dst (EUR-cross)."""
        if v is None or not src or not dst:
            return None
        src, dst = MAJOR.get(src, src), MAJOR.get(dst, dst)
        if src == dst:
            return v
        a, b = self.rate(src), self.rate(dst)
        return v / a * b if a and b else None


def shape(sym, spec, qs, ts, ts_ccy, fx, now):
    price = qs.get("price") or {}
    sd = qs.get("summaryDetail") or {}
    ks = qs.get("defaultKeyStatistics") or {}
    fd = qs.get("financialData") or {}
    cal = qs.get("calendarEvents") or {}
    prof = qs.get("assetProfile") or {}
    pccy = price.get("currency") or sd.get("currency")          # may be a minor unit (GBp, ILA, ZAc)
    pmaj = MAJOR.get(pccy, pccy)
    minor = 100.0 if pccy in MAJOR else 1.0
    fccy = fd.get("financialCurrency") or ts_ccy or pmaj

    px = num(price.get("regularMarketPrice")) or num(fd.get("currentPrice"))
    mcap = num(price.get("marketCap")) or num(sd.get("marketCap"))   # Yahoo reports cap in the major unit
    annual = series(ts, "annual", N_ANNUAL)
    quarterly = series(ts, "quarterly", N_QUARTER)
    t12 = ttm(ts, quarterly)

    # balance-sheet point-in-time (latest quarter, else latest annual), reporting currency
    debt, d_debt = latest(ts, "TotalDebt")
    cash, _ = latest(ts, "CashCashEquivalentsAndShortTermInvestments")
    if cash is None:
        cash, _ = latest(ts, "CashAndCashEquivalents")
    nd = (debt - cash) if debt is not None and cash is not None else latest(ts, "NetDebt")[0]
    mi, _ = latest(ts, "MinorityInterest")
    eq, _ = latest(ts, "StockholdersEquity")

    # EV in trading currency: market cap + net debt (+ minorities), converting the reporting-currency
    # balance sheet first. Yahoo's own enterpriseValue mixes currencies for cross-currency reporters.
    mcap_f = fx.conv(mcap, pmaj, fccy)
    ev, ev_src = None, None
    if mcap is not None and nd is not None:
        adj = fx.conv(nd + (mi or 0), fccy, pmaj)
        if adj is not None:
            ev, ev_src = mcap + adj, "calc"
    if ev is None and num(ks.get("enterpriseValue")) is not None and fccy == pmaj:
        ev, ev_src = num(ks.get("enterpriseValue")), "yahoo"
    ev_f = fx.conv(ev, pmaj, fccy)

    def ratio(a, b, lo=None):
        if a is None or b is None or b == 0:
            return None
        if lo is not None and b <= lo:
            return None
        return rnd(a / b, 2)

    pe_ttm = num(sd.get("trailingPE"))
    if pe_ttm is None and mcap_f is not None and t12.get("ni") and t12["ni"] > 0:
        pe_ttm = mcap_f / t12["ni"]
    val = dict(
        mcap=sig(mcap), ev=sig(ev), ev_src=ev_src,
        mcap_eur=sig(fx.conv(mcap, pmaj, "EUR")), ev_eur=sig(fx.conv(ev, pmaj, "EUR")),
        pe=rnd(pe_ttm), pe_fwd=rnd(num(sd.get("forwardPE"))),
        ev_ebitda=ratio(ev_f, t12.get("ebitda"), lo=0), ev_rev=ratio(ev_f, t12.get("rev"), lo=0),
        pb=ratio(mcap_f, eq, lo=0) if (eq and mcap_f) else rnd(num(ks.get("priceToBook"))),
        dy=rnd((num(sd.get("dividendYield")) or 0) * 100, 2) if num(sd.get("dividendYield")) is not None else None,
        neg_earn=bool(t12.get("ni") is not None and t12["ni"] < 0),
        neg_ebitda=bool(t12.get("ebitda") is not None and t12["ebitda"] < 0),
        nd=sig(nd), shares=sig(num(ks.get("sharesOutstanding")) or num(ks.get("impliedSharesOutstanding"))),
    )
    for k in ("pe", "pe_fwd"):            # Yahoo sometimes emits nonsense multiples (currency mix-ups)
        if val[k] is not None and not (0 < val[k] < 1000):
            val[k] = None

    # consensus (targets in trading currency, same basis as financialData.currentPrice)
    tgt = num(fd.get("targetMeanPrice"))
    cur = num(fd.get("currentPrice")) or px
    n_an = num(fd.get("numberOfAnalystOpinions"))
    rec = None
    for t in (qs.get("recommendationTrend") or {}).get("trend") or []:
        if t.get("period") == "0m":
            rec = {k: int(t.get(k) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}
            if not sum(rec.values()):
                rec = None
    est = {}
    for t in (qs.get("earningsTrend") or {}).get("trend") or []:
        if t.get("period") not in ("0y", "+1y"):
            continue
        ee, re_ = t.get("earningsEstimate") or {}, t.get("revenueEstimate") or {}
        rev, eps = num(re_.get("avg")), num(ee.get("avg"))
        n_rev, n_eps = num(re_.get("numberOfAnalysts")), num(ee.get("numberOfAnalysts"))
        e = dict(end=t.get("endDate"),
                 rev=sig(rev) if rev and n_rev else None, rev_n=int(n_rev) if n_rev else None,
                 rev_ccy=re_.get("revenueCurrency") or (fccy if rev and n_rev else None),
                 eps=rnd(eps, 4) if eps is not None and n_eps else None, eps_n=int(n_eps) if n_eps else None,
                 eps_ccy=ee.get("earningsCurrency") or (fccy if n_eps else None),
                 rev_g=rnd((num(re_.get("growth")) or 0) * 100, 1) if num(re_.get("growth")) is not None and n_rev else None,
                 eps_g=rnd((num(ee.get("growth")) or 0) * 100, 1) if num(ee.get("growth")) is not None and n_eps else None)
        if e["rev"] is not None or e["eps"] is not None:
            est["cy" if t["period"] == "0y" else "ny"] = e
    cons = dict(
        target=rnd(tgt, 4), target_hi=rnd(num(fd.get("targetHighPrice")), 4), target_lo=rnd(num(fd.get("targetLowPrice")), 4),
        target_med=rnd(num(fd.get("targetMedianPrice")), 4),
        upside=rnd((tgt / cur - 1) * 100, 1) if tgt and cur else None,
        rating=(fd.get("recommendationKey") if fd.get("recommendationKey") not in (None, "none") else None),
        rating_mean=rnd(num(fd.get("recommendationMean")), 2), analysts=int(n_an) if n_an else None,
        breakdown=rec, est=est or None,
    )
    if not cons["analysts"] and not tgt:
        cons.update(target=None, target_hi=None, target_lo=None, target_med=None, upside=None)

    ed = (cal.get("earnings") or {}).get("earningsDate") or []
    dates = dict(
        earnings=iso_date(ed[0]) if ed else None,
        earnings_to=iso_date(ed[1]) if len(ed) > 1 else None,
        earnings_est=bool((cal.get("earnings") or {}).get("isEarningsDateEstimate")),
        ex_div=iso_date(cal.get("exDividendDate")) or iso_date(sd.get("exDividendDate")),
        div_pay=iso_date(cal.get("dividendDate")),
        last_q=iso_date(ks.get("mostRecentQuarter")),
        fy_end=iso_date(ks.get("lastFiscalYearEnd")),
    )
    web = prof.get("website")
    profile = dict(sector=prof.get("sectorDisp") or prof.get("sector"), industry=prof.get("industryDisp") or prof.get("industry"),
                   country=prof.get("country"), website=web if web and re.match(r"^https?://", web) else None,
                   summary=first_sentences(prof.get("longBusinessSummary")))
    chg_pct = num(price.get("regularMarketChangePercent"))
    return dict(
        sym=sym, name=spec["name"], long_name=price.get("longName") or price.get("shortName"),
        exch=price.get("exchangeName"), ccy=pccy, fin_ccy=fccy, px=rnd(px, 6),
        chg_pct=rnd(chg_pct * 100, 3) if chg_pct is not None else None,
        market_time=dt.datetime.fromtimestamp(price["regularMarketTime"], UTC).isoformat() if isinstance(price.get("regularMarketTime"), (int, float)) else None,
        val=val, cons=cons,
        fin=dict(ccy=fccy, annual=annual, quarterly=quarterly, ttm=t12 if any(v is not None for k, v in t12.items() if k != "d") else None),
        dates=dates, profile=profile, fetched_at=now.isoformat(timespec="seconds"),
    )


def coverage(c):
    v, k, f = c.get("val") or {}, c.get("cons") or {}, c.get("fin") or {}
    return dict(val=any(v.get(x) is not None for x in ("pe", "pe_fwd", "ev_ebitda", "ev_rev", "pb")),
                cons=bool(k.get("analysts") or k.get("target")),
                fin=bool(f.get("annual") or f.get("quarterly")))


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "companies.json"))
    ap.add_argument("--only", default="")
    ap.add_argument("--extra", default="", help="extra Yahoo symbols (testing), name = symbol")
    ap.add_argument("--sleep", type=float, default=0.6)
    a = ap.parse_args()
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    now = dt.datetime.now(UTC)

    specs = {}
    for g in GROUPS:
        for sec in g["sections"]:
            for r in sec["rows"]:
                if r.get("kind", "equity") == "equity":
                    specs.setdefault(r["sym"], r)
    for s in [x.strip() for x in a.extra.split(",") if x.strip()]:
        specs.setdefault(s, dict(sym=s, name=s, kind="equity"))
    syms = [s for s in specs if not only or s in only or s in a.extra.split(",")]

    prev = {}
    try:
        with open(a.out) as f:
            prev = (json.load(f) or {}).get("companies") or {}
    except Exception:
        pass

    crumb = [yahoo_crumb(SESSION)]
    raw, errors = {}, []
    t0 = time.time()
    for i, sym in enumerate(syms):
        qs = ts = ts_ccy = None
        err = []
        try:
            qs = fetch_summary(sym, crumb)
        except Exception as e:
            err.append(f"quoteSummary: {e}")
        time.sleep(a.sleep * 0.5 + random.uniform(0, 0.2))
        try:
            ts, ts_ccy = fetch_timeseries(sym, crumb)
        except Exception as e:
            err.append(f"timeseries: {e}")
        if qs is not None:
            raw[sym] = (qs, ts or {}, ts_ccy)
        if err:
            errors.append(dict(sym=sym, error="; ".join(err)[:300]))
        log(f"[{i+1}/{len(syms)}] {sym}: qs={'ok' if qs else 'FAIL'} ts={len(ts or {})} series {'; '.join(err)}")
        time.sleep(a.sleep + random.uniform(0, 0.3))

    if len(raw) < MIN_OK_SHARE * len(syms) and prev:
        log(f"Only {len(raw)}/{len(syms)} fetched - keeping {a.out}")
        return 2

    needed = {"EUR", "USD"}
    for qs, ts, tc in raw.values():
        for c in ((qs.get("price") or {}).get("currency"), (qs.get("financialData") or {}).get("financialCurrency"), tc):
            if c:
                needed.add(MAJOR.get(c, c))
    fx_table = build_fx_table(needed)
    fx = FX(fx_table)

    out_c = {}
    for sym in syms:
        spec = specs[sym]
        if sym in raw:
            qs, ts, tc = raw[sym]
            try:
                c = shape(sym, spec, qs, ts, tc, fx, now)
                old = prev.get(sym)
                # timeseries failed this run: keep last good financials rather than blanking them
                if not ts and old and old.get("fin") and (old["fin"].get("annual") or old["fin"].get("quarterly")):
                    c["fin"] = old["fin"]
                    c["fin_stale"] = old.get("fin_fetched_at") or old.get("fetched_at")
                else:
                    c["fin_fetched_at"] = c["fetched_at"]
                out_c[sym] = c
                continue
            except Exception as e:
                errors.append(dict(sym=sym, error=f"shape: {e}"[:300]))
                log(f"  {sym}: shape failed {e}")
        if sym in prev:
            c = dict(prev[sym])
            c["stale"] = True
            c["name"] = spec["name"]
            out_c[sym] = c

    cov = {k: sum(1 for c in out_c.values() if coverage(c)[k]) for k in ("val", "cons", "fin")}
    out = dict(
        generated_utc=now.isoformat(timespec="seconds"),
        source="Yahoo Finance quoteSummary + fundamentals-timeseries. May be incomplete for small caps.",
        method=dict(
            ev="Market cap + net debt (latest reported total debt minus cash & short-term investments) + minority interest, "
               "reporting-currency balance sheet converted at the current EUR-cross; Yahoo enterpriseValue only when no balance sheet.",
            multiples="EV/EBITDA and EV/Revenue on trailing twelve months (both in reporting currency); P/E trailing and forward "
                      "as published by Yahoo; P/B = market cap / latest shareholders' equity.",
            financials="Reporting currency. Net debt = total debt minus cash & short-term investments. FCF = Yahoo free cash flow "
                       "(operating cash flow + capex).",
            units="Market cap / EV / targets / price in trading currency (GBp quotes: market cap in GBP). *_eur converted to EUR.",
        ),
        fx_eur={k: v.get("rate") for k, v in fx_table.items()},
        count=len(out_c), coverage=cov, seconds=round(time.time() - t0, 1),
        companies=out_c, errors=errors,
    )
    if only or a.extra:
        log(json.dumps(cov))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    os.replace(tmp, a.out)
    log(f"wrote {a.out}: {len(out_c)} companies, coverage {cov}, {len(errors)} errors, {out['seconds']}s, {os.path.getsize(a.out)//1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
