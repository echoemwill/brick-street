"""
StockPulse Scraper
Fetches S&P500 symbols from stockanalysis.com, then pulls analyst
sell/hold/buy counts from MarketBeat for each symbol.

Resume-safe: progress is saved to data/progress.json after every stock.
Final filtered results are written to data/filtered_stocks.json.

Filtering criteria:
  - buy  >= 10
  - hold <= 10
  - sell <  5
"""

import asyncio
import json
import random
import time
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

PROGRESS_FILE = DATA_DIR / "progress.json"
FILTERED_FILE = DATA_DIR / "filtered_stocks.json"
ALL_RESULTS_FILE = DATA_DIR / "all_results.json"

# Filtering thresholds
MIN_BUY   = 10
MAX_HOLD  = 10
MAX_SELL  = 5

# Delay between requests (seconds) — random in this range to mimic human behaviour
DELAY_MIN = 6
DELAY_MAX = 12


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"done": {}, "symbols": []}


def save_progress(progress: dict):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)


def save_filtered(results: dict):
    filtered = {
        symbol: data
        for symbol, data in results.items()
        if (
            data.get("buy",  0) >= MIN_BUY  and
            data.get("hold", 99) <= MAX_HOLD and
            data.get("sell", 99) < MAX_SELL
        )
    }
    with open(FILTERED_FILE, "w") as f:
        json.dump(filtered, f, indent=2)
    with open(ALL_RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n✅ Filtered: {len(filtered)} stocks match criteria out of {len(results)} processed")
    return filtered


async def fetch_symbols(page) -> list:
    print("📋 Fetching S&P 500 symbols from stockanalysis.com …")
    await page.goto("https://stockanalysis.com/list/sp-500-stocks/", wait_until="networkidle", timeout=60000)
    await page.wait_for_timeout(3000)

    # Try multiple selectors to find ticker symbols
    symbols = []

    selectors = [
        "table tbody tr td:first-child a",
        "table tbody tr td:nth-child(2) a",
        "table tbody tr td a",
        "[class*='symbol']",
        "td a[href*='/stocks/']",
    ]

    for sel in selectors:
        try:
            symbols = await page.eval_on_selector_all(
                sel,
                "els => els.map(el => el.textContent.trim()).filter(t => t.length > 0 && t.length <= 5 && /^[A-Z]+$/.test(t))"
            )
            if len(symbols) > 10:
                break
        except Exception:
            continue

    # Fallback: extract from page text via regex
    if len(symbols) < 10:
        content = await page.content()
        import re
        symbols = re.findall(r'href="/stocks/([A-Z]{1,5})/"', content)
        symbols = list(dict.fromkeys(symbols))  # deduplicate, preserve order

    symbols = [s for s in symbols if s and 1 <= len(s) <= 5]
    print(f"   Found {len(symbols)} symbols")
    return symbols


async def fetch_analyst_data(page, symbol: str):
    url = f"https://www.marketbeat.com/stocks/NASDAQ/{symbol}/forecast/"
    fallback_url = f"https://www.marketbeat.com/stocks/NYSE/{symbol}/forecast/"

    for attempt_url in [url, fallback_url]:
        try:
            await page.goto(attempt_url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)

            # Look for analyst rating table / counts
            # MarketBeat shows something like "12 Buy", "5 Hold", "2 Sell"
            content = await page.content()

            # Try structured selector first
            data = await page.evaluate("""() => {
                const result = { buy: 0, hold: 0, sell: 0 };
                const found = { buy: false, hold: false, sell: false };

                // Look for rating summary boxes / table rows
                const allText = document.body.innerText;

                // Pattern: number followed by Buy/Hold/Sell label
                const patterns = [
                    { key: 'buy',  regex: /(\\d+)\\s*Buy/gi },
                    { key: 'hold', regex: /(\\d+)\\s*Hold/gi },
                    { key: 'sell', regex: /(\\d+)\\s*Sell/gi },
                ];

                for (const { key, regex } of patterns) {
                    let match;
                    let max = 0;
                    while ((match = regex.exec(allText)) !== null) {
                        const val = parseInt(match[1], 10);
                        if (val > max) max = val;
                        found[key] = true;
                    }
                    result[key] = max;
                }

                if (!found.buy && !found.hold && !found.sell) return null;
                return result;
            }""")

            if data and (data["buy"] > 0 or data["hold"] > 0 or data["sell"] > 0):
                return data

        except PlaywrightTimeout:
            continue
        except Exception as e:
            print(f"      Error on {attempt_url}: {e}")
            continue

    return None


async def main():
    progress = load_progress()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        page = await context.new_page()

        # Fetch symbols if we don't have them yet
        if not progress["symbols"]:
            symbols = await fetch_symbols(page)
            progress["symbols"] = symbols
            save_progress(progress)
        else:
            symbols = progress["symbols"]
            print(f"📋 Resuming — {len(progress['done'])} already done, {len(symbols) - len(progress['done'])} remaining")

        total = len(symbols)
        for i, symbol in enumerate(symbols, 1):
            if symbol in progress["done"]:
                continue

            print(f"[{i}/{total}] {symbol} … ", end="", flush=True)

            data = await fetch_analyst_data(page, symbol)

            if data:
                progress["done"][symbol] = data
                tag = ""
                if (data["buy"] >= MIN_BUY and data["hold"] <= MAX_HOLD and data["sell"] < MAX_SELL):
                    tag = " ⭐ MATCHES FILTER"
                print(f"buy={data['buy']} hold={data['hold']} sell={data['sell']}{tag}")
            else:
                progress["done"][symbol] = {"buy": 0, "hold": 0, "sell": 0, "error": True}
                print("no data found")

            save_progress(progress)

            # Human-like delay
            delay = random.uniform(DELAY_MIN, DELAY_MAX)
            print(f"   ⏳ Waiting {delay:.1f}s …")
            await asyncio.sleep(delay)

        await browser.close()

    # Final save + filter
    filtered = save_filtered(progress["done"])
    print("\n🏆 Stocks matching criteria (buy ≥ 10, hold ≤ 10, sell < 5):")
    for symbol, d in sorted(filtered.items(), key=lambda x: x[1]["buy"], reverse=True):
        print(f"   {symbol:6s}  BUY={d['buy']:2d}  HOLD={d['hold']:2d}  SELL={d['sell']:2d}")

    print(f"\n✅ Done. Results saved to:")
    print(f"   {ALL_RESULTS_FILE}")
    print(f"   {FILTERED_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
