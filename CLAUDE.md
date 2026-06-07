# Brick Street — S&P 500 Analyst Intelligence Dashboard

## What it does

A real-time financial intelligence dashboard that:
- Pulls analyst consensus ratings (Buy / Hold / Sell) for every S&P 500 stock from Finnhub (licensed API)

- Enriches each stock with live prices and quarterly EPS earnings surprise data
- Shows an upcoming economic events calendar with market impact explanations
- Displays everything on a professional-grade dashboard

---

## ⚖️ Data sourcing policy (READ BEFORE ADDING ANY DATA SOURCE)

This is a hard rule for **every** change to this project, now and in the future.

**Only use legitimate, licensed data sources that grant us the legal right to use
and display their information.** Never integrate a source that could expose the
project to legal action.

Concretely:
- ✅ **Use** official, documented APIs with clear terms of service (e.g. Finnhub,
  FRED) where the licence covers our use case.
- ❌ **Do not** scrape websites, use unofficial/undocumented endpoints, or
  otherwise pull data in a way that violates a provider's terms of service or
  copyright (e.g. MarketBeat scraping, Yahoo/yfinance unofficial endpoints).
- 💳 **Paid is fine.** If a source requires a paid or commercial/redistribution
  plan before it can be used commercially, that is acceptable — the owner will pay
  for it. Prefer a properly licensed paid source over a free-but-unlicensed one.
- 📜 Honour each provider's **attribution** requirements (credit them in the UI).
- When adding a source, confirm in the code/docs **which licence tier** is required
  for commercial use, and note it in `LICENSING.md`.

If a requested feature can only be built with a source that fails these rules,
**stop and flag it** rather than implementing it — propose an alternative.

---
- This section File structure to be updated only when its mentioned to update the CLAUDE.md 
## File structure

```
StockPulse/
├── CLAUDE.md
├── LICENSING.md              ← Go-legit checklist (data licence, payments, legal)
├── requirements.txt          ← Python dependencies
├── .env                      ← API keys + BS_SECRET (never commit this)
│
│   ── LICENSED DATA PATH (use these) ──
├── data_sources.py           ← Finnhub client (analyst ratings, prices, earnings)
├── fetch_stocks.py           ← Orchestrator: ratings → filter → prices → earnings
├── fetch_fed_rate.py         ← Federal Reserve rate history (FRED API, public domain)
├── fetch_macro.py            ← Unemployment / CPI / GDP indicators (FRED, public domain)
├── fetch_calendar.py         ← Economic events calendar (Finnhub API)
├── auth_server.py            ← Flask server: serves site + login/watchlist API
│
│   ── DEPRECATED scrapers (non-commercial only; need ALLOW_SCRAPING=1) ──
├── scraper.py                ← OLD MarketBeat scraper (Playwright) — do not use
├── fetch_prices.py           ← OLD Yahoo price fetcher — do not use
├── fetch_earnings.py         ← OLD yfinance earnings fetcher — do not use
│
├── data/
│   ├── sp500_symbols.json    ← Bundled S&P 500 list (fallback for fetch_stocks)
│   ├── stock_progress.json   ← fetch_stocks resume state (auto-created)
│   ├── all_results.json      ← Every stock scored (auto-created)
│   ├── filtered_stocks.json  ← Stocks passing the filter + prices (read by website)
│   ├── earnings.json         ← EPS surprise data per stock (read by website)
│   ├── fed_rate.json         ← Fed rate history + next meeting (read by website)
│   ├── macro.json            ← Unemployment / CPI / GDP indicators (read by website)
│   ├── calendar.json         ← Upcoming economic events (read by website)
│   └── users.db              ← User accounts + watchlists + journal (gitignored)
└── website/
    ├── index.html
    ├── style.css
    ├── app.js
    ├── journal.css           ← Trading/investment journal styles
    ├── journal.js            ← Journal logic (local for guests, synced for accounts)
    └── legal.html            ← Terms, Privacy, Disclaimer (draft — lawyer review)
```

> **Journal:** the "Journal" view tab offers a **Trading** and an **Investing**
> template (toggle). Smart manual entry — symbol auto-fills price/company via
> `/api/quote`, and P&L / % / R-multiple / holding period compute automatically.
> Guests get an unlimited **local** journal (`localStorage`, device-only); logged-in
> users get **server sync** (`journal_entries` table), an **analytics** dashboard,
> and **CSV export**. On login, local entries migrate up to the account once.
> API: `GET/POST /api/journal`, `DELETE /api/journal/<client_id>` (see `auth_server.py`).
> Future: CSV import + optional broker API sync.

> **Going commercial?** All stock data now comes from **Finnhub** (licensed) via
> `data_sources.py` + `fetch_stocks.py`, replacing the deprecated scrapers. A public,
> paid site requires a Finnhub commercial/redistribution plan — see `LICENSING.md`.

---

## Running the scripts

### One-time setup

```bash
cd StockPulse
pip3 install -r requirements.txt
```
(Playwright is only needed for the deprecated scrapers — not the licensed path.)

### API keys / secrets required

Add to a `.env` file in the StockPulse folder:

```env
FRED_API_KEY=your_key_here        # free at fred.stlouisfed.org
FINNHUB_API_KEY=your_key_here     # finnhub.io — commercial plan for a public paid site
BS_SECRET=your_random_32+_chars   # JWT signing secret (auth_server). Generate with:
                                  #   python3 -c "import secrets;print(secrets.token_hex(32))"
```

### Run order

**Step 1 — analyst ratings + prices + earnings (licensed, ~25–35 min):**
```bash
python3 fetch_stocks.py
```
Pulls analyst consensus for all ~500 S&P 500 stocks from Finnhub, then adds the
current price + last 4 quarters of EPS surprise for **every** scored stock (the
website displays the whole list, sortable by Buy/Hold/Sell/Price). It also flags
the strong-buy survivors (buy ≥ 10, hold ≤ 10, sell < 5) into
`filtered_stocks.json` for backward compatibility. Resume-safe via
`data/stock_progress.json` + the `price` key in `all_results.json`.
Outputs: `data/all_results.json` (full list w/ price), `data/earnings.json`,
`data/filtered_stocks.json` (survivors)

**Step 2 — independent, run anytime:**
```bash
python3 fetch_fed_rate.py   # → data/fed_rate.json  (FRED, public domain)
python3 fetch_macro.py      # → data/macro.json     (FRED, public domain)
python3 fetch_calendar.py   # → data/calendar.json  (Finnhub)
```

### Serve the website

```bash
cd StockPulse
BS_SECRET=$(python3 -c "import secrets;print(secrets.token_hex(32))") python3 auth_server.py
# open http://localhost:8080
```
`auth_server.py` serves the website *and* the login/watchlist API on one port.
(For a static-only preview without auth, `python3 -m http.server 8080` still works.)

---

## Data sources

| Source | What we get | Licensing |
|--------|-------------|-----------|
| Finnhub | Analyst Buy/Hold/Sell, prices, EPS earnings, economic calendar | API key — **commercial plan required for the public paid site** (see LICENSING.md) |
| FRED (Federal Reserve) | Fed funds rate history + target range | Free, public domain |

Bundled `data/sp500_symbols.json` provides the S&P 500 membership list (public
factual data) as a fallback when Finnhub's constituents endpoint isn't on your plan.

**Deprecated / non-commercial only:** MarketBeat (scraping), Yahoo Finance &
yfinance (unofficial endpoints), stockanalysis.com. The old `scraper.py`,
`fetch_prices.py`, and `fetch_earnings.py` now refuse to run without
`ALLOW_SCRAPING=1` and must not be used commercially.

---

## Website features

### Dashboard
- **Analyst ratings table** — all stocks passing the Buy/Hold/Sell filter
- **Signal % bar** — buy % of total analyst votes per stock
- **Earnings column** — last 4 quarters of EPS surprise % (green = beat, red = miss)
- **Prices** — current price per stock, pre-loaded from `filtered_stocks.json` (licensed Finnhub data)
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

- `fetch_stocks.py` is resume-safe via `data/stock_progress.json` — safe to interrupt and re-run. Delete that file to force a full re-fetch.
- `earnings.json` — if stocks show N/A, delete the file and re-run `fetch_stocks.py` (nulls are retried).
- Finnhub free tier is fine for development/testing but is **non-commercial**; a public paid site needs a commercial/redistribution plan (see `LICENSING.md`).
- `data_sources.py` is the single provider abstraction — swapping Finnhub for another licensed provider means editing only that one file.
- Before going live: set `BS_ENV=production`, a strong `BS_SECRET`, `BS_ALLOWED_ORIGINS`, and serve over HTTPS.


################### Stuf imported by me ###################
 ## Rule regarding the efficiency 

 When prompt you to change something in thie website always keep in mind that the new change must not cause any kind of bug or disfunctionallity of something else which is working already perfect on the website. 

 ## Rules regarding the privileges available for the non loged user, the loged user and the user which is on subscription plan 3$ a mounth. 

 When I tell you to create something and do not mention nothing about this functionality would be available to a user of subscription then this is created for everybody. 

 When I want to make something available for the logged in user, then I will mention it like "Make this available only for the loggedin user. 

 And If I want you to create something and mention that this is only for the accounts with subscription then this is what i mean. 

 ## Rule about the cost 

Everytime when we add a new source of information to the project or add new functionality which in a some way required buying something like API's, data access etc. And when I ask you how much money will be my costs, you calculate all the costs and tell me how much it will be per day/mounth/year and give me this information. 

