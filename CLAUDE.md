# Brick Street — S&P 500 Analyst Intelligence Dashboard

## What it does

A real-time financial intelligence dashboard that:
- Scrapes analyst consensus ratings (Buy / Hold / Sell) for every S&P 500 stock from MarketBeat
- Filters for the strongest buy signals only
- Enriches each stock with live prices and quarterly EPS earnings surprise data
- Shows the current Federal Reserve interest rate and history
- Shows an upcoming economic events calendar with market impact explanations
- Displays everything on a dark, animated, professional-grade dashboard

**Stock filter criteria (all three must pass):**
- Buy  ≥ 10
- Hold ≤ 10
- Sell <  5

---

## File structure

```
StockPulse/
├── CLAUDE.md
├── requirements.txt          ← Python dependencies
├── .env                      ← API keys (never commit this)
├── scraper.py                ← Main scraper — analyst ratings (Playwright)
├── fetch_prices.py           ← Stock price fetcher (Yahoo Finance via yfinance)
├── fetch_earnings.py         ← EPS earnings surprise fetcher (Yahoo Finance via yfinance)
├── fetch_fed_rate.py         ← Federal Reserve rate history (FRED API)
├── fetch_calendar.py         ← Economic events calendar (Finnhub API)
├── data/
│   ├── progress.json         ← Scraper progress (auto-created, resume-safe)
│   ├── all_results.json      ← Every stock scraped (auto-created)
│   ├── filtered_stocks.json  ← Stocks passing the filter + prices (read by website)
│   ├── earnings.json         ← EPS surprise data per stock (read by website)
│   ├── fed_rate.json         ← Fed rate history + next meeting (read by website)
│   └── calendar.json         ← Upcoming economic events (read by website)
└── website/
    ├── index.html
    ├── style.css
    └── app.js
```

---

## Running the scripts

### One-time setup

```bash
cd StockPulse
pip3 install -r requirements.txt
python3 -m playwright install chromium
```

### API keys required

Add to a `.env` file in the StockPulse folder:

```env
FRED_API_KEY=your_key_here        # free at fred.stlouisfed.org
FINNHUB_API_KEY=your_key_here     # free at finnhub.io
```

### Run order

**Step 1 — must run first (1.5–3 hours):**
```bash
python3 scraper.py
```
Scrapes MarketBeat for analyst ratings on all ~503 S&P 500 stocks.
Resume-safe — if interrupted, re-running picks up where it left off.
Output: `data/filtered_stocks.json`

**Step 2 — run after Step 1, can run simultaneously:**
```bash
# Terminal 1
python3 fetch_prices.py

# Terminal 2 (at the same time)
python3 fetch_earnings.py
```
- `fetch_prices.py` — adds current stock price to each entry in `filtered_stocks.json`
- `fetch_earnings.py` — fetches last 4 quarters of EPS surprise % → `data/earnings.json`

**Step 3 — independent, run anytime:**
```bash
python3 fetch_fed_rate.py    # → data/fed_rate.json
python3 fetch_calendar.py   # → data/calendar.json
```
These do not depend on `scraper.py` and can be refreshed at any time.

### Serve the website

```bash
cd StockPulse
python3 -m http.server 8080
# open http://localhost:8080/website/
```

---

## Data sources

| Source | What we get | API key needed |
|--------|-------------|---------------|
| stockanalysis.com | S&P 500 ticker list | No |
| MarketBeat | Buy / Hold / Sell analyst ratings | No (Playwright scraping) |
| Yahoo Finance (yfinance) | Live stock prices + EPS earnings history | No |
| FRED (Federal Reserve) | Fed funds rate history + target range | Yes — free |
| Finnhub | Upcoming economic calendar events | Yes — free |

---

## Website features

### Dashboard
- **Analyst ratings table** — all stocks passing the Buy/Hold/Sell filter
- **Signal % bar** — buy % of total analyst votes per stock
- **Earnings column** — last 4 quarters of EPS surprise % (green = beat, red = miss)
- **Live prices** — fetched directly in browser from Yahoo Finance
- **TradingView charts** — inline chart panel on hover/click per stock
- **Sort + search** — sort by Buy/Hold/Sell/Symbol, live search

### Left panel — Fed Interest Rate
- Slides in from the left on hover
- Shows: current rate range, last 10 rate changes, next FOMC meeting date, expected direction, market impact explanation

### Right panel — Economic Calendar
- Slides in from the right on hover
- Shows: upcoming high and medium impact US economic events (CPI, NFP, GDP, FOMC, etc.)
- Click any event to expand a full detail view: what it is, why it matters, bull/bear market scenarios, affected sectors, what to watch
- Back button returns to the event list

### Bottom sections
- **How to use** — 8 cards explaining every dashboard feature
- **Data Sources** — 4 cards describing each data provider with credibility notes

### Visual design
- Deep dark navy background (#0a0c14) with circuit board canvas animation
- Glassmorphism cards with backdrop blur
- GSAP scroll-triggered animations on all cards and rows
- Ambient floating particles
- Logo flicker + glitch effects
- Smooth panel open/close transitions (expo-out easing)

---

## Notes

- `earnings.json` — if all stocks show N/A, delete the file and re-run `fetch_earnings.py`
- `fetch_earnings.py` — resumes from where it left off; nulls are retried on each run
- `scraper.py` — tries both NASDAQ and NYSE exchange URLs per symbol
- All scripts are resume-safe — safe to interrupt and re-run
