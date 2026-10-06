# Markets Monitor

Static markets dashboard (GitHub Pages): https://masterkano.github.io/markets-monitor/

Immediate share link (no Pages wait): https://raw.githack.com/MasterKano/markets-monitor/main/index.html

## Pages

Top-level tabs (URL hash in brackets; older hashes such as `#nordic`, `#rates`, `#monitor` redirect):

- **Equities** (default, `#equities/<chip>`): chips Renewables (incl. benchmarks and strategic peers), Oil & Gas (incl. London-listed E&Ps),
  Metals & Mining, Lundin Group. Price returns 1D to 10Y, volume vs 5/20/50-day averages (ratio highlighted above 1.5x),
  distance from 10/20/50/200-day moving averages, a 1-year sparkline, market cap / EV in EUR, company panel and news.
- **Macro** (`#macro[/indices|commodities|rates]`): Indices, Commodities and Rates & FX as sections on one page (no
  company data), merged macro news.
  Heatmap colours are scaled per horizon. Click a header to sort, a row to open its TradingView chart.
  *Compact* hides 2Y-10Y and the 5d/10d columns; the *Volume* and *Moving avg* switches show/hide those column
  groups (off by default on phones/narrow screens, on for desktop; choices are remembered per browser).
  Instrument, Market (listing venue) and Last stay pinned while scrolling sideways. A collapsible
  "How to read this table" panel explains price source, volume ratios and MA distances. Missing data shows as `n/a`.
- **Power** (`#power`): Nordic Power dashboard with its own sub-navigation (Spot, Forwards, Drivers, SE4, News): day-ahead map of the Nordic bidding zones coloured by today's (or tomorrow's)
  daily average, zones × hours heatmap (negative prices outlined), daily/7d/30d averages and key spreads; EEX forward
  curves per zone with the Nordic system price and Germany overlaid, a zone × tenor table (price, day/week/since-1-Sep
  changes, implied EPAD vs system, vs DE), zone premia and benchmark history; power drivers (TTF, EUA, API2 coal,
  GoO wind); Norwegian reservoir filling vs the NVE 2006–2025 min/median/max band plus a Swedish snapshot; news.
- **Charts** (`#charts`): four TradingView widget charts styled like the table cards (Timeframe and Moving averages
  controls apply to all four; the row pop-up chart in Equities/Macro always opens Daily with 50/100/200-day MAs): Markets, Commodities, FX and Rates / Bonds.
  Markets has an instrument dropdown plus type-ahead search over `data/symbols.json` (built by
  `scripts/build_symbols.py`: London LSE/AIM, Sweden OMX Stockholm, Norway Oslo, New York NYSE/Nasdaq/Arca,
  Toronto TSX/TSXV, Hong Kong HKEX, plus every equity/ETF/index TV symbol in `scripts/universe.py` and curated
  energy/mining peers such as Genel Energy). Client-side only — no API keys; TradingView's remote symbol-search often
  returns 403 from static hosts, so the offline index is the primary autofill. Quick-pick chips and in-widget symbol
  change remain. Searched symbols are kept under "Recent". Exotic names outside the index may need `EXCH:SYM` or the
  in-chart TradingView search. Rates / Bonds uses Treasury and credit ETFs because TradingView does not allow Treasury
  yields (TVC:US*) in embedded widgets; for the same reason, yield rows on the Table open a Yahoo 1-year line chart
  (TradingView ↗ still links to the full chart).

## Data

`.github/workflows/update-data.yml` runs on weekdays at 05:30, 12:30 (Nordic Power only) and 21:00 UTC (markets and
news only), and on demand, and commits:

- `data/market.json` from `scripts/build_data.py`: Yahoo Finance daily bars (chart API with retries/backoff,
  yfinance fallback). Price returns, not total return. Futures are continuous front-month, so long horizons
  include roll effects. Universe: `scripts/universe.py`.
- Intraday prices: `.github/workflows/intraday.yml` runs `build_data.py --intraday` every 15 min on weekdays
  (:07/:22/:37/:52, 05-21 UTC): latest Yahoo quote + time, 1D vs previous close, mkt cap / EV scaled from the last full build.
  It is not committed: it force-pushes a single-commit orphan branch `live-data`, which the page reads from
  raw.githubusercontent.com (using whichever of that and `data/market.json` is newer).
- `data/news.json` from `scripts/build_news.py`: Google News RSS searches plus exchange announcements
  (Oslo Børs NewsWeb, Nasdaq Nordic). Headlines and links only. FT excluded.
- `data/companies.json` + `data/co/SYMBOL.json` from `scripts/build_companies.py` (05:30 and 21:00 runs): the
  company page (click a company name in the Table; shareable as `#co=SYMBOL&tab=fin|analysts|own|mgmt`).
  `companies.json` is a small index (price, valuation, consensus, key stats, dates) read with the Table;
  `data/co/SYMBOL.json` holds the detail loaded on demand when a page opens: profile, officers and pay,
  governance scores, ownership and top holders, insider transactions and holders, recommendation trend,
  rating changes, estimates and revisions, earnings surprises, full income / balance / cash-flow statements
  (5 years, 6 quarters, TTM), ratios and dividend history. Sources: Yahoo quoteSummary, the
  fundamentals-timeseries endpoint and the chart endpoint (dividends), fetched with 4 threads. EV = market cap
  + net debt (+ minorities) with the balance sheet converted at current FX. Per-symbol failures keep the previous
  files; detail files are only rewritten when their content changes.

- `data/symbols.json` from `scripts/build_symbols.py`: offline Markets chart autofill catalog (name + TradingView
  `EXCH:SYM` + kind). Built from Nasdaq Trader directories and a filtered free ticker database for LSE/AIM, OMXSTO,
  OSL, NYSE/Nasdaq/Arca, TSX/TSXV and HKEX; no API keys. Re-run locally when refreshing the catalog; optional in CI.
- `data/power.json` from `scripts/build_power.py`:
  - EEX daily settlements from the public CSV at `MasterKano/scrape` (`master/eex_master.csv`, read via
    raw.githubusercontent.com). Base-load Month/Quarter/Year futures for the Nordic system price, the Nordic zones
    (outright EEX Nordic Zonal Futures, not EPADs) and DE/FR/NL/GB/ES/IT, plus TTF, EUA, API2 coal and GoO wind.
    History starts 1 Sep 2026 (no backfill). Contracts already in delivery are excluded.
  - Day-ahead prices (A44) for NO1–NO5, SE1–SE4, FI, DK1, DK2 plus DE-LU, PL, LT from the ENTSO-E Transparency
    Platform (needs the `ENTSOE_API_TOKEN` env var / GitHub secret; 92 days of history). Fallbacks per zone:
    Energy-Charts (Fraunhofer ISE, CC BY 4.0), Energinet Energi Data Service (DK1, DK2, NO2, SE3, SE4, DE) and
    spot-hinta.fi (today/tomorrow only). Daily averages from earlier runs are kept so 7d/30d averages survive outages.
    15-min prices are averaged to hourly; days are CET delivery days and are shown in Geneva time.
  - ENTSO-E SE4 detail: wind/solar actual (A75) vs day-ahead forecast (A69, short horizon only), load actual vs
    day-ahead forecast and week-ahead min/max (A65), physical flows on SE4 borders (A11, fallback for SVK),
    unavailabilities (A78 interconnectors, A80 generation aggregated by fuel; no unit/plant/line names) and weekly
    reservoir stored energy (A72) for SE1–SE4 / NO1–NO5. Wind/solar capture prices (7d/30d, daily, and expected
    today/tomorrow from the forecast) are computed from A44 × A75/A69. ~60 requests per run, throttled well below the
    400/min limit, retried on 429/5xx; failed parts keep the previous values. The token is never logged.
  - Hydro: NVE magasinstatistikk API (Norway and NO1–NO5, weekly) and the Energiföretagen weekly PDF (Sweden snapshot).
  - FI / DE-LU capture prices use Energy-Charts generation.
  - Schedule: power runs at 05:30 and 12:30 UTC on weekdays (12:30 captures tomorrow's day-ahead prices), at 12:30
    UTC on Saturdays and Sundays, and daily at 17:30 UTC, after the D-1 18:00 Brussels deadline for the day-ahead
    wind/solar forecast (A69), so the SE4 "tomorrow expected" capture row fills in.

Local run: `pip install -r scripts/requirements.txt && python scripts/build_data.py && python scripts/build_news.py && python scripts/build_power.py && python scripts/build_symbols.py && python scripts/build_companies.py`,
then `python -m http.server` and open http://localhost:8000/.
