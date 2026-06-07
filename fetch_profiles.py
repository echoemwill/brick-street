"""
Brick Street — Company Profile Fetcher (Finnhub, licensed)

Fetches the sector and logo for every scored S&P 500 stock from Finnhub's
/stock/profile2 endpoint and writes them to data/profiles.json. The website
reads this file to show a logo next to each symbol and a Sector chip column.

Resume-safe: existing entries in profiles.json are kept and skipped, so the
script is safe to interrupt and re-run. Delete data/profiles.json to force a
full re-fetch.

Symbols are read from data/all_results.json (every scored stock); if that file
is missing it falls back to the bundled data/sp500_symbols.json.

Requires FINNHUB_API_KEY in .env (see CLAUDE.md). All data comes from the
licensed Finnhub provider — no scraping. Output: data/profiles.json

Usage:
    python3 fetch_profiles.py
"""

import json
from pathlib import Path

from data_sources import Finnhub, FinnhubError

DATA_DIR     = Path(__file__).parent / "data"
OUTPUT_FILE  = DATA_DIR / "profiles.json"
ALL_RESULTS  = DATA_DIR / "all_results.json"
SP500_LIST   = DATA_DIR / "sp500_symbols.json"


def load_symbols():
    """Every scored symbol, falling back to the bundled S&P 500 list."""
    if ALL_RESULTS.exists():
        data = json.loads(ALL_RESULTS.read_text())
        if isinstance(data, dict) and data:
            return list(data.keys())
    if SP500_LIST.exists():
        data = json.loads(SP500_LIST.read_text())
        # The bundled list may be a plain list or a list of {symbol: ...} dicts.
        if isinstance(data, list):
            return [s if isinstance(s, str) else s.get("symbol") for s in data if s]
    return []


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

    # Resume: keep what we already have, only fetch the gaps.
    profiles = {}
    if OUTPUT_FILE.exists():
        try:
            profiles = json.loads(OUTPUT_FILE.read_text())
        except json.JSONDecodeError:
            profiles = {}

    todo = [s for s in symbols if s not in profiles]
    print(f"🏢  {len(symbols)} symbols · {len(profiles)} cached · {len(todo)} to fetch")

    for i, symbol in enumerate(todo, 1):
        try:
            p = client.profile(symbol)
        except Exception as e:  # never crash the whole run on one bad symbol
            print(f"   ⚠️  {symbol}: {e}")
            p = None

        profiles[symbol] = p or {"name": None, "sector": None, "logo": None}
        sector = (profiles[symbol].get("sector") or "—")[:24]
        print(f"   [{i}/{len(todo)}] {symbol:<6} {sector}")

        # Persist periodically so an interrupt doesn't lose progress.
        if i % 25 == 0:
            OUTPUT_FILE.write_text(json.dumps(profiles, indent=2))

    OUTPUT_FILE.write_text(json.dumps(profiles, indent=2))

    with_sector = sum(1 for p in profiles.values() if p.get("sector"))
    with_logo   = sum(1 for p in profiles.values() if p.get("logo"))
    print(f"✅  {len(profiles)} profiles saved  ({with_sector} sectors · {with_logo} logos)")
    print(f"   Saved → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
