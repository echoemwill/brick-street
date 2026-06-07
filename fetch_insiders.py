"""
Brick Street — Insider Trades Fetcher (Finnhub, licensed)

Pulls major open-market insider TRADES — both BUYS (SEC Form 4 code "P") and
SELLS (code "S") — for every scored S&P 500 stock and writes them to
data/insiders.json. The website's "Insider Trades" column reads this file.

Only genuine open-market purchases and sales count — option exercises, tax
withholding and stock grants are excluded (see data_sources.insider_trades).

Resume-safe: per-symbol results are cached under "by_symbol"; already-fetched
symbols are skipped. Delete data/insiders.json to force a full re-fetch.

Symbols come from data/all_results.json (every scored stock), falling back to
the bundled data/sp500_symbols.json. All data is licensed Finnhub — no
scraping. Output: data/insiders.json

Usage:
    python3 fetch_insiders.py
"""

import json
from datetime import datetime, timedelta
from pathlib import Path

from data_sources import Finnhub, FinnhubError

DATA_DIR    = Path(__file__).parent / "data"
OUTPUT_FILE = DATA_DIR / "insiders.json"
ALL_RESULTS = DATA_DIR / "all_results.json"
SP500_LIST  = DATA_DIR / "sp500_symbols.json"

# How far back to keep buys, and how many to surface in the panel.
LOOKBACK_DAYS = 365
PANEL_LIMIT   = 60


def load_symbols():
    if ALL_RESULTS.exists():
        data = json.loads(ALL_RESULTS.read_text())
        if isinstance(data, dict) and data:
            return list(data.keys())
    if SP500_LIST.exists():
        data = json.loads(SP500_LIST.read_text())
        if isinstance(data, list):
            return [s if isinstance(s, str) else s.get("symbol") for s in data if s]
    return []


def build_panel(by_symbol):
    """Flatten per-symbol trades into one newest-first list for the website."""
    flat = []
    for symbol, trades in by_symbol.items():
        for t in trades:
            flat.append({"symbol": symbol, **t})
    flat.sort(key=lambda x: x["date"], reverse=True)
    return flat[:PANEL_LIMIT]


def main():
    try:
        client = Finnhub()
    except FinnhubError as e:
        print(f"❌  {e}")
        return

    symbols = load_symbols()
    if not symbols:
        print("❌  No symbols found. Run fetch_stocks.py first, or ensure "
              "data/sp500_symbols.json exists.")
        return

    since = (datetime.today() - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    by_symbol = {}
    if OUTPUT_FILE.exists():
        try:
            by_symbol = json.loads(OUTPUT_FILE.read_text()).get("by_symbol", {})
        except (json.JSONDecodeError, AttributeError):
            by_symbol = {}

    todo = [s for s in symbols if s not in by_symbol]
    print(f"💰  {len(symbols)} symbols · {len(by_symbol)} cached · {len(todo)} to fetch "
          f"(trades since {since})")

    def save():
        OUTPUT_FILE.write_text(json.dumps({
            "last_updated": datetime.today().strftime("%Y-%m-%d"),
            "trades":       build_panel(by_symbol),
            "by_symbol":    by_symbol,
        }, indent=2))

    found = 0
    for i, symbol in enumerate(todo, 1):
        try:
            trades = client.insider_trades(symbol, since=since)
        except Exception as e:  # never crash the whole run on one bad symbol
            print(f"   ⚠️  {symbol}: {e}")
            trades = []
        by_symbol[symbol] = trades
        if trades:
            found += len(trades)
            top = trades[0]
            icon = "🟢" if top["direction"] == "buy" else "🔴"
            sign = "+" if top["direction"] == "buy" else "−"
            print(f"   [{i}/{len(todo)}] {symbol:<6} {icon} {len(trades)} trade(s) — "
                  f"{top['name']} {sign}{top['shares']:,} on {top['date']}")
        if i % 25 == 0:
            save()

    save()
    panel = build_panel(by_symbol)
    print(f"✅  {found} insider trades found across {len(by_symbol)} stocks · "
          f"panel shows newest {len(panel)}")
    print(f"   Saved → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
