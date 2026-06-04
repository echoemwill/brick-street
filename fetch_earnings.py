"""
StockPulse Earnings Fetcher
Fetches the last 4 quarters of EPS surprise % for every stock in
data/filtered_stocks.json using yfinance (no browser needed).

Output: data/earnings.json  ← read directly by the website

Usage:
    python3 fetch_earnings.py

Resume-safe: already-processed symbols are skipped on re-run.
"""

import json
import time
import random
from pathlib import Path
import yfinance as yf

DATA_DIR      = Path(__file__).parent / "data"
FILTERED_FILE = DATA_DIR / "filtered_stocks.json"
EARNINGS_FILE = DATA_DIR / "earnings.json"

def load_existing():
    if EARNINGS_FILE.exists():
        with open(EARNINGS_FILE) as f:
            return json.load(f)
    return {}

def save(data):
    with open(EARNINGS_FILE, "w") as f:
        json.dump(data, f, indent=2)

def fetch_symbol(symbol):
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.earnings_history

        if hist is None or hist.empty:
            return None

        results = []
        for _, row in hist.tail(4).iterrows():
            surprise = row.get("surprisePercent")
            quarter  = str(row.name)[:7]
            if surprise is not None and surprise == surprise:  # skip NaN
                results.append({
                    "quarter":  quarter,
                    "surprise": round(float(surprise) * 100, 1)
                })

        return results if results else None

    except Exception as e:
        print(f"  ERROR {symbol}: {e}")
        return None

def main():
    if not FILTERED_FILE.exists():
        print("❌  data/filtered_stocks.json not found — run scraper.py first.")
        return

    with open(FILTERED_FILE) as f:
        stocks = list(json.load(f).keys())

    earnings = load_existing()
    remaining = [s for s in stocks if earnings.get(s) is None]

    print(f"📊  Total stocks  : {len(stocks)}")
    print(f"✅  Already done  : {len(earnings)}")
    print(f"⏳  To fetch      : {len(remaining)}")

    if not remaining:
        print("Nothing to do.")
        return

    total = len(remaining)
    for idx, symbol in enumerate(remaining, 1):
        quarters = fetch_symbol(symbol)
        earnings[symbol] = quarters

        if quarters:
            preview = "  ".join(f"{q['quarter']} {q['surprise']:+.1f}%" for q in quarters)
            print(f"[{idx}/{total}] {symbol:6s}  ✓  {preview}")
        else:
            print(f"[{idx}/{total}] {symbol:6s}  N/A")

        save(earnings)
        time.sleep(random.uniform(0.3, 0.7))

    found = sum(1 for v in earnings.values() if v)
    print(f"\n✅  Done — {found}/{len(earnings)} stocks have earnings data.")
    print(f"   Saved → {EARNINGS_FILE}")

if __name__ == "__main__":
    main()
