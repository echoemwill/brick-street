"""
Brick Street — Stock Data Orchestrator (licensed / Finnhub)

This is the new, licensed replacement for the legacy scraping path
(scraper.py + fetch_prices.py + fetch_earnings.py — all now deprecated).
Everything here comes from Finnhub under a commercial licence.

Pipeline:
  1. Get the S&P 500 symbol list (Finnhub constituents, else bundled list)
  2. For each symbol → analyst consensus (buy/hold/sell)
  3. Add current price for EVERY scored stock (the website shows them all)
  4. Pull last 4 quarters of EPS surprise for EVERY scored stock
  5. Also flag which symbols pass the strong-buy filter (buy >= 10, hold <= 10,
     sell < 5) and write them to filtered_stocks.json for backward compatibility

Outputs (drop-in compatible with the website):
  data/all_results.json       { SYMBOL: {buy, hold, sell, price} }   ← full list
  data/earnings.json          { SYMBOL: [{quarter, surprise}, ...] }
  data/filtered_stocks.json   { SYMBOL: {buy, hold, sell, price} }   ← survivors
  data/stock_progress.json    resume state (safe to interrupt & re-run)

Usage:
    python3 fetch_stocks.py
"""

import json
from pathlib import Path

from data_sources import Finnhub, FinnhubError

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

PROGRESS_FILE = DATA_DIR / "stock_progress.json"
FILTERED_FILE = DATA_DIR / "filtered_stocks.json"
ALL_RESULTS_FILE = DATA_DIR / "all_results.json"
EARNINGS_FILE = DATA_DIR / "earnings.json"
SYMBOLS_FILE = DATA_DIR / "sp500_symbols.json"

# Filter thresholds (unchanged from the original scraper)
MIN_BUY = 10
MAX_HOLD = 10
MAX_SELL = 5


def _load_json(path, default):
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return default


def _save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def get_symbols(client: Finnhub) -> list:
    """S&P 500 list. Try Finnhub (paid), else the bundled local snapshot."""
    try:
        syms = client.sp500_symbols()
        if syms:
            print(f"📋 Using Finnhub constituents: {len(syms)} symbols")
            _save_json(SYMBOLS_FILE, sorted(syms))
            return syms
    except (FinnhubError, Exception) as e:
        print(f"ℹ️  Finnhub constituents unavailable ({str(e)[:60]}…) — using bundled list")
    syms = _load_json(SYMBOLS_FILE, [])
    if not syms:
        syms = sorted(_load_json(ALL_RESULTS_FILE, {}).keys())
    print(f"📋 Using bundled S&P 500 list: {len(syms)} symbols")
    return syms


def passes_filter(d: dict) -> bool:
    return (d.get("buy", 0) >= MIN_BUY
            and d.get("hold", 99) <= MAX_HOLD
            and d.get("sell", 99) < MAX_SELL)


def main():
    try:
        client = Finnhub()
    except FinnhubError as e:
        print(f"❌  {e}")
        return

    symbols = get_symbols(client)
    if not symbols:
        print("❌  No symbols to process.")
        return

    progress = _load_json(PROGRESS_FILE, {"ratings": {}})
    ratings = progress["ratings"]

    # ── Step 1+2: analyst consensus for every symbol ──────────
    todo = [s for s in symbols if s not in ratings]
    print(f"\n📊 Analyst consensus — {len(ratings)} done, {len(todo)} to fetch\n")
    for i, symbol in enumerate(todo, 1):
        try:
            rec = client.recommendation(symbol)
        except FinnhubError as e:
            print(f"[{i}/{len(todo)}] {symbol:6s}  ✗ {str(e)[:70]}")
            # 401/403 means a key/plan problem — stop rather than spam errors.
            if "401" in str(e) or "403" in str(e):
                print("\n⛔  Stopping: fix the API key / plan, then re-run (resume-safe).")
                return
            continue

        if rec:
            ratings[symbol] = {"buy": rec["buy"], "hold": rec["hold"], "sell": rec["sell"]}
            tag = " ⭐ MATCH" if passes_filter(ratings[symbol]) else ""
            print(f"[{i}/{len(todo)}] {symbol:6s}  buy={rec['buy']:3d} hold={rec['hold']:3d} sell={rec['sell']:3d}{tag}")
        else:
            ratings[symbol] = {"buy": 0, "hold": 0, "sell": 0, "no_data": True}
            print(f"[{i}/{len(todo)}] {symbol:6s}  — no analyst data")
        _save_json(PROGRESS_FILE, progress)

    # Persist the full ratings set (every symbol scored)
    _save_json(ALL_RESULTS_FILE, ratings)

    # Stocks with real analyst data (skip the "no_data" placeholders)
    scored = [s for s, d in ratings.items() if not d.get("no_data")]

    # ── Step 3: prices for EVERY scored stock (resume-safe) ───
    todo_p = [s for s in scored if "price" not in ratings[s]]
    print(f"\n💰 Prices — {len(scored) - len(todo_p)} done, {len(todo_p)} to fetch")
    for i, symbol in enumerate(todo_p, 1):
        try:
            price = client.quote(symbol)
        except FinnhubError as e:
            print(f"[{i}/{len(todo_p)}] {symbol:6s}  ✗ {str(e)[:60]}")
            price = None
        ratings[symbol]["price"] = price  # None = "tried, no price" (won't refetch)
        if price:
            print(f"[{i}/{len(todo_p)}] {symbol:6s}  ${price:.2f}")
        else:
            print(f"[{i}/{len(todo_p)}] {symbol:6s}  — no price")
        _save_json(ALL_RESULTS_FILE, ratings)

    # ── Step 4: earnings for EVERY scored stock (resume-safe) ─
    earnings = _load_json(EARNINGS_FILE, {})
    todo_e = [s for s in scored if earnings.get(s) is None]
    print(f"\n📈 Earnings — {len([v for v in earnings.values() if v])} done, {len(todo_e)} to fetch")
    for i, symbol in enumerate(todo_e, 1):
        try:
            earnings[symbol] = client.earnings(symbol)
        except FinnhubError as e:
            print(f"[{i}/{len(todo_e)}] {symbol:6s}  ✗ {str(e)[:60]}")
            earnings[symbol] = None
        if earnings[symbol]:
            preview = "  ".join(f"{q['quarter']} {q['surprise']:+.1f}%" for q in earnings[symbol])
            print(f"[{i}/{len(todo_e)}] {symbol:6s}  ✓ {preview}")
        else:
            print(f"[{i}/{len(todo_e)}] {symbol:6s}  N/A")
        _save_json(EARNINGS_FILE, earnings)

    # ── Step 5: filtered_stocks.json (survivors, backward compat) ──
    survivors = {s: d for s, d in ratings.items() if passes_filter(d)}
    filtered_out = {
        s: {k: d[k] for k in ("buy", "hold", "sell", "price") if d.get(k) is not None}
        for s, d in survivors.items()
    }
    _save_json(FILTERED_FILE, filtered_out)
    print(f"\n🏆 {len(survivors)} stocks pass the strong-buy filter "
          f"(buy≥{MIN_BUY}, hold≤{MAX_HOLD}, sell<{MAX_SELL})")

    priced = sum(1 for s in scored if ratings[s].get("price"))
    print("\n✅ Done.")
    print(f"   {ALL_RESULTS_FILE}  ({len(ratings)} stocks, {priced} priced)")
    print(f"   {EARNINGS_FILE}")
    print(f"   {FILTERED_FILE}  ({len(filtered_out)} survivors)")


if __name__ == "__main__":
    main()
