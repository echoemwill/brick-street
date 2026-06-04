"""
StockPulse Fed Rate Fetcher
Fetches the last 10 Federal Reserve rate changes from the FRED API.

Requires a free FRED API key:
  1. Go to https://fred.stlouisfed.org/docs/api/api_key.html
  2. Create a free account and request an API key (instant)
  3. Add it to a .env file in this folder: FRED_API_KEY=your_key_here

Output: data/fed_rate.json

Usage:
    python3 fetch_fed_rate.py
"""

import json
import os
import requests
from datetime import datetime
from pathlib import Path

DATA_DIR    = Path(__file__).parent / "data"
OUTPUT_FILE = DATA_DIR / "fed_rate.json"
ENV_FILE    = Path(__file__).parent / ".env"

# ── Load .env ─────────────────────────────────────────────────────────────────

def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

# ── FOMC meeting dates (decision announced on last day) ───────────────────────

FOMC_DATES = sorted([
    "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17",
    "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-10",
    "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
    "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
])

def get_next_meeting():
    today = datetime.today().strftime("%Y-%m-%d")
    for date_str in FOMC_DATES:
        if date_str >= today:
            dt         = datetime.strptime(date_str, "%Y-%m-%d")
            days_until = (dt - datetime.today()).days
            return {
                "date":       date_str,
                "label":      dt.strftime("%b %d, %Y"),
                "days_until": max(0, days_until),
            }
    return None

# ── FRED API ──────────────────────────────────────────────────────────────────

def fetch_fred(series_id, api_key):
    resp = requests.get(
        "https://api.stlouisfed.org/fred/series/observations",
        params={
            "series_id":          series_id,
            "api_key":            api_key,
            "file_type":          "json",
            "sort_order":         "asc",
            "observation_start":  "2015-01-01",
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["observations"]

def parse_changes(lower_obs, upper_obs):
    upper_map  = {o["date"]: float(o["value"]) for o in upper_obs if o["value"] != "."}
    changes    = []
    prev_lower = None

    for obs in lower_obs:
        if obs["value"] == ".":
            continue
        lower = round(float(obs["value"]), 2)
        upper = round(upper_map.get(obs["date"], lower + 0.25), 2)

        if prev_lower is not None and lower != prev_lower:
            change    = round(lower - prev_lower, 2)
            direction = "cut" if change < 0 else "hike"
            dt        = datetime.strptime(obs["date"], "%Y-%m-%d")

            changes.append({
                "date":      obs["date"],
                "label":     dt.strftime("%b %Y"),
                "lower":     lower,
                "upper":     upper,
                "change":    change,
                "direction": direction,
            })
        prev_lower = lower

    current_lower = prev_lower or 0.0
    current_upper = round(upper_map.get(lower_obs[-1]["date"] if lower_obs else "", current_lower + 0.25), 2)

    return changes[-10:], current_lower, current_upper

# ── Market impact copy ─────────────────────────────────────────────────────────

MARKET_IMPACT = {
    "hold": (
        "Rates on hold provide stability and predictability. "
        "Markets have priced in current conditions — S&P 500 performance "
        "will hinge on earnings rather than rate expectations. "
        "Growth and tech stocks remain supported."
    ),
    "cut": (
        "A rate cut lowers borrowing costs across the economy — bullish for equities. "
        "Growth and tech stocks benefit most as future earnings are discounted at a lower rate. "
        "REITs, utilities, and dividend stocks also rally on cheaper money."
    ),
    "hike": (
        "Higher rates raise borrowing costs for companies and consumers — a headwind for equities. "
        "Growth and high-PE tech stocks face the most pressure. "
        "Financials may benefit from wider margins, but the broader market typically reprices lower."
    ),
}

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    env     = load_env()
    api_key = env.get("FRED_API_KEY") or os.environ.get("FRED_API_KEY", "")

    if not api_key:
        print("❌  FRED_API_KEY not set.")
        print("   1. Register free at: https://fred.stlouisfed.org/docs/api/api_key.html")
        print("   2. Create a file called .env in the StockPulse folder with:")
        print("      FRED_API_KEY=your_key_here")
        print("   3. Re-run this script.")
        return

    print("📡  Fetching Fed rate data from FRED…")

    try:
        lower_obs = fetch_fred("DFEDTARL", api_key)
        upper_obs = fetch_fred("DFEDTARU", api_key)
    except requests.HTTPError as e:
        print(f"❌  FRED API error: {e}")
        if "400" in str(e) or "403" in str(e):
            print("   Your API key may be invalid or not yet active.")
        return
    except Exception as e:
        print(f"❌  Network error: {e}")
        return

    changes, current_lower, current_upper = parse_changes(lower_obs, upper_obs)
    next_meeting = get_next_meeting()

    # Default expected direction to "hold" — update manually if needed
    if next_meeting:
        next_meeting["expected"] = "hold"

    output = {
        "current_lower":  current_lower,
        "current_upper":  current_upper,
        "last_updated":   datetime.today().strftime("%Y-%m-%d"),
        "next_meeting":   next_meeting,
        "market_impact":  MARKET_IMPACT,
        "history":        changes,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"✅  Current rate: {current_lower:.2f}% – {current_upper:.2f}%")
    print(f"   Last 10 changes saved.")
    if next_meeting:
        print(f"   Next meeting: {next_meeting['label']} ({next_meeting['days_until']} days)")
    print(f"   Saved → {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
