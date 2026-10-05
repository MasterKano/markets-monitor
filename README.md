# Markets Monitor

Static markets dashboard (GitHub Pages): https://masterkano.github.io/markets-monitor/

Immediate share link (no Pages wait): https://raw.githack.com/MasterKano/markets-monitor/main/index.html

## Pages

- **Table** (default): tabs per group (Nordic Renewables, Energy, Lundin Group, Metals & Mining, Commodities,
  Indices, Rates & FX). Price returns 1D to 10Y, volume vs 5/10/20/50-day averages (ratio highlighted above 1.5x),
  distance from 10/20/50/200-day moving averages, a 1-year sparkline and a news panel per tab.
  Heatmap colours are scaled per horizon. Click a header to sort, a row to open its TradingView chart.
  *Compact* hides 2Y-10Y and the 5d/10d columns; the *Volume* and *Moving avg* switches show/hide those column
  groups (off by default on phones/narrow screens, on for desktop; choices are remembered per browser).
  Instrument, Market (listing venue) and Last stay pinned while scrolling sideways. A collapsible
  "How to read this table" panel explains price source, volume ratios and MA distances. Missing data shows as `n/a`.
- **Nordic Power** (tab on the Table page): day-ahead map of the Nordic bidding zones coloured by today's (or tomorrow's)
  daily average, zones × hours heatmap (negative prices outlined), daily/7d/30d averages and key spreads; EEX forward
  curves per zone with the Nordic system price and Germany overlaid, a zone × tenor table (price, day/week/since-1-Sep
  changes, implied EPAD vs system, vs DE), zone premia and benchmark history; power drivers (TTF, EUA, API2 coal,
  GoO wind); Norwegian reservoir filling vs the NVE 2006–2025 min/median/max band plus a Swedish snapshot; news.
- **Monitor**: four TradingView widget charts styled like the Table cards: Markets, Commodities, FX and Rates / Bonds.
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
- `data/news.json` from `scripts/build_news.py`: Google News RSS searches plus exchange announcements
  (Oslo Børs NewsWeb, Nasdaq Nordic). Headlines and links only. FT excluded.

- `data/symbols.json` from `scripts/build_symbols.py`: offline Markets chart autofill catalog (name + TradingView
  `EXCH:SYM` + kind). Built from Nasdaq Trader directories and a filtered free ticker database for LSE/AIM, OMXSTO,
  OSL, NYSE/Nasdaq/Arca, TSX/TSXV and HKEX; no API keys. Re-run locally when refreshing the catalog; optional in CI.
- `data/power.json` from `scripts/build_power.py`:
  - EEX daily settlements from the public CSV at `MasterKano/scrape` (`master/eex_master.csv`, read via
    raw.githubusercontent.com). Base-load Month/Quarter/Year futures for the Nordic system price, the Nordic zones
    (outright EEX Nordic Zonal Futures, not EPADs) and DE/FR/NL/GB/ES/IT, plus TTF, EUA, API2 coal and GoO wind.
    History starts 1 Sep 2026 (no backfill). Contracts already in delivery are excluded.
  - Day-ahead prices per bidding zone from the Energy-Charts API (Fraunhofer ISE, CC BY 4.0; ~2 requests/minute, so
    this step takes a few minutes). Fallbacks: Energinet Energi Data Service (DK1, DK2, NO2, SE3, SE4, DE) and
    spot-hinta.fi (today/tomorrow only). Daily averages from earlier runs are kept so 7d/30d averages survive outages.
    15-min prices are averaged to hourly; days are CET delivery days and are shown in Geneva time.
  - Hydro: NVE magasinstatistikk API (Norway and NO1–NO5, weekly) and the Energiföretagen weekly PDF (Sweden snapshot).
  - Capture prices are computed (generation-weighted average price) only where Energy-Charts publishes generation.

Local run: `pip install -r scripts/requirements.txt && python scripts/build_data.py && python scripts/build_news.py && python scripts/build_power.py && python scripts/build_symbols.py`,
then `python -m http.server` and open http://localhost:8000/.
