"""
StockPulse Macro Indicators Fetcher
Fetches three headline U.S. economic indicators from the FRED API:

  - Unemployment Rate   (FRED: UNRATE)
  - CPI Inflation, YoY   (FRED: CPIAUCSL → year-over-year % change)
  - GDP Growth Rate      (FRED: A191RL1Q225SBEA, real GDP, annualised QoQ)

All three are U.S. government public-domain data (no licence required), the same
source as the Fed funds rate. Powers the macro tiles next to the Fed Rate tile.

Requires a free FRED API key (same one used by fetch_fed_rate.py):
  1. https://fred.stlouisfed.org/docs/api/api_key.html
  2. Add to .env:  FRED_API_KEY=your_key_here

Output: data/macro.json

Usage:
    python3 fetch_macro.py
"""

import json
import os
import requests
from datetime import datetime
from pathlib import Path

DATA_DIR    = Path(__file__).parent / "data"
OUTPUT_FILE = DATA_DIR / "macro.json"
ENV_FILE    = Path(__file__).parent / ".env"

HISTORY_LEN = 6  # readings to show in each popover


def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def fetch_series(series_id, api_key, start="2022-01-01"):
    """Return [(date_str, float_value), ...] ascending, skipping missing points."""
    resp = requests.get(
        "https://api.stlouisfed.org/fred/series/observations",
        params={
            "series_id":         series_id,
            "api_key":           api_key,
            "file_type":         "json",
            "sort_order":        "asc",
            "observation_start": start,
        },
        timeout=15,
    )
    resp.raise_for_status()
    out = []
    for o in resp.json()["observations"]:
        if o["value"] == ".":
            continue
        out.append((o["date"], float(o["value"])))
    return out


def month_label(date_str):
    return datetime.strptime(date_str, "%Y-%m-%d").strftime("%b %Y")


def quarter_label(date_str):
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    q = (dt.month - 1) // 3 + 1
    return f"Q{q} {dt.year}"


def direction(curr, prev):
    if prev is None or curr == prev:
        return "flat"
    return "up" if curr > prev else "down"


def build_history(series, labeler, fmt, length=HISTORY_LEN):
    """Newest-first history list with per-reading direction vs the prior point."""
    hist = []
    for i in range(len(series) - 1, max(-1, len(series) - 1 - length), -1):
        date, val = series[i]
        prev = series[i - 1][1] if i - 1 >= 0 else None
        hist.append({
            "label":     labeler(date),
            "value":     fmt(val),
            "direction": direction(val, prev),
        })
    return hist


# ── Market-impact copy (static, plain-language) ───────────────────────────────

IMPACT = {
    "unemployment": (
        "The Fed has a dual mandate: stable prices <strong>and</strong> maximum employment. "
        "A rising unemployment rate cools the economy and gives the Fed room to cut rates — "
        "generally <strong>bullish</strong> for equities. A very low rate keeps the Fed hawkish, "
        "pressuring rate-sensitive growth and tech stocks."
    ),
    "cpi": (
        "CPI is the headline inflation gauge; the Fed targets ~2%. A hot CPI print means the Fed "
        "stays restrictive or hikes — a <strong>headwind</strong> for stocks, especially high-PE tech. "
        "Cooling inflation opens the door to rate cuts and typically fuels a <strong>broad rally</strong>."
    ),
    "gdp": (
        "GDP is the broadest measure of economic health and drives corporate earnings. Solid growth "
        "(~2–3%) supports equities and cyclicals. Contraction — two negative quarters is a recession — "
        "sparks a <strong>defensive rotation</strong> into staples, healthcare, and bonds."
    ),
}


def main():
    env     = load_env()
    api_key = env.get("FRED_API_KEY") or os.environ.get("FRED_API_KEY", "")

    if not api_key:
        print("❌  FRED_API_KEY not set.")
        print("   1. Register free at: https://fred.stlouisfed.org/docs/api/api_key.html")
        print("   2. Add to .env:  FRED_API_KEY=your_key_here")
        print("   3. Re-run this script.")
        return

    print("📡  Fetching macro indicators from FRED…")

    try:
        unrate = fetch_series("UNRATE", api_key)
        cpi    = fetch_series("CPIAUCSL", api_key, start="2021-01-01")
        gdp    = fetch_series("A191RL1Q225SBEA", api_key)
    except requests.HTTPError as e:
        print(f"❌  FRED API error: {e}")
        return
    except Exception as e:
        print(f"❌  Network error: {e}")
        return

    indicators = {}

    # ── Unemployment ──────────────────────────────────────────
    if unrate:
        pct = lambda v: f"{v:.1f}%"
        indicators["unemployment"] = {
            "title":   "Unemployment Rate",
            "value":   pct(unrate[-1][1]),
            "as_of":   month_label(unrate[-1][0]),
            "impact":  IMPACT["unemployment"],
            "history": build_history(unrate, month_label, pct),
        }

    # ── CPI → year-over-year inflation ────────────────────────
    if len(cpi) > 13:
        # Build a YoY series: for each month, compare to 12 months earlier.
        yoy = []
        for i in range(12, len(cpi)):
            d_now, v_now = cpi[i]
            v_year_ago   = cpi[i - 12][1]
            if v_year_ago:
                yoy.append((d_now, (v_now / v_year_ago - 1) * 100))
        if yoy:
            pct = lambda v: f"{v:.1f}%"
            indicators["cpi"] = {
                "title":   "CPI Inflation (YoY)",
                "value":   pct(yoy[-1][1]),
                "as_of":   month_label(yoy[-1][0]),
                "impact":  IMPACT["cpi"],
                "history": build_history(yoy, month_label, pct),
            }

    # ── GDP growth (annualised QoQ) ───────────────────────────
    if gdp:
        pct = lambda v: f"{v:+.1f}%"
        indicators["gdp"] = {
            "title":   "GDP Growth (annualised)",
            "value":   pct(gdp[-1][1]),
            "as_of":   quarter_label(gdp[-1][0]),
            "impact":  IMPACT["gdp"],
            "history": build_history(gdp, quarter_label, pct),
        }

    output = {
        "last_updated": datetime.today().strftime("%Y-%m-%d"),
        "indicators":   indicators,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    for key, ind in indicators.items():
        print(f"✅  {ind['title']:28s} {ind['value']:>8s}  (as of {ind['as_of']})")
    print(f"   Saved → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
