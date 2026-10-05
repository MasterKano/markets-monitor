# Markets Monitor

Static markets dashboard (GitHub Pages): https://masterkano.github.io/markets-monitor/

Immediate share link (no Pages wait): https://raw.githack.com/MasterKano/markets-monitor/main/index.html

## Pages

- **Table** (default): tabs per group (Nordic Renewables, Energy, Lundin Group, Metals & Mining, Commodities,
  Indices, Rates & FX). Price returns 1D to 10Y, volume vs 5/10/20/50-day averages (ratio highlighted above 1.5x),
  distance from 10/20/50/200-day moving averages, a 1-year sparkline and a news panel per tab.
  Heatmap colours are scaled per horizon. Click a header to sort, a row to open its TradingView chart.
  *Compact* hides 2Y-10Y and the 5d/10d columns. Missing data shows as `n/a`.
- **Monitor** / **Equities**: TradingView widget charts (unchanged).

## Data

`.github/workflows/update-data.yml` runs on weekdays at 05:30 and 21:00 UTC (and on demand) and commits:

- `data/market.json` from `scripts/build_data.py`: Yahoo Finance daily bars (chart API with retries/backoff,
  yfinance fallback). Price returns, not total return. Futures are continuous front-month, so long horizons
  include roll effects. Universe: `scripts/universe.py`.
- `data/news.json` from `scripts/build_news.py`: Google News RSS searches plus exchange announcements
  (Oslo Børs NewsWeb, Nasdaq Nordic). Headlines and links only. FT excluded.

Local run: `pip install -r scripts/requirements.txt && python scripts/build_data.py && python scripts/build_news.py`,
then `python -m http.server` and open http://localhost:8000/.
