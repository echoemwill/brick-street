"""
Brick Street — Price Fetcher  —  ⚠️ DEPRECATED / NON-COMMERCIAL ONLY

Superseded by fetch_stocks.py. This file hits Yahoo Finance's unofficial,
unlicensed endpoints, which is fine for personal use but not for a commercial
product. Prices for the paid site now come from Finnhub (licensed) inside
fetch_stocks.py. Kept for reference; refuses to run unless ALLOW_SCRAPING=1.

Reads filtered_stocks.json, adds current price for each stock
from Yahoo Finance (no API key needed), saves back to the file.
"""

import os as _os
if __name__ == "__main__" and _os.environ.get("ALLOW_SCRAPING") != "1":
    raise SystemExit(
        "⚠️  fetch_prices.py is DEPRECATED (unlicensed Yahoo endpoint).\n"
        "   Use:  python3 fetch_stocks.py   (licensed Finnhub prices)\n"
        "   To run anyway (non-commercial), set ALLOW_SCRAPING=1."
    )

import json
import time
import random
import urllib.request
import urllib.error
from pathlib import Path

DATA_FILE = Path(__file__).parent / "data" / "filtered_stocks.json"


def fetch_price(symbol: str):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0",
        "Accept":     "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data  = json.loads(resp.read())
            price = data["chart"]["result"][0]["meta"]["regularMarketPrice"]
            return round(float(price), 2)
    except Exception:
        return None


def main():
    if not DATA_FILE.exists():
        print("❌ filtered_stocks.json not found — run scraper.py first")
        return

    with open(DATA_FILE) as f:
        stocks = json.load(f)

    total = len(stocks)
    print(f"💰 Fetching prices for {total} stocks …\n")

    for i, (symbol, data) in enumerate(stocks.items(), 1):
        price = fetch_price(symbol)
        if price:
            data["price"] = price
            print(f"[{i}/{total}] {symbol:6s}  ${price:.2f}")
        else:
            print(f"[{i}/{total}] {symbol:6s}  — no price")

        delay = random.uniform(0.4, 0.9)
        time.sleep(delay)

    with open(DATA_FILE, "w") as f:
        json.dump(stocks, f, indent=2)

    print(f"\n✅ Prices saved to {DATA_FILE}")


if __name__ == "__main__":
    main()
