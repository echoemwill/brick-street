"""
StockPulse Economic Calendar Fetcher
Fetches upcoming high-impact economic events for the world's 10 largest
economies from the Finnhub API.

Requires a free Finnhub API key:
  1. Go to https://finnhub.io  → click "Get free API key"
  2. Add to .env:  FINNHUB_API_KEY=your_key_here

Output: data/calendar.json

Usage:
    python3 fetch_calendar.py
"""

import json
import os
import requests
from datetime import datetime, timedelta
from pathlib import Path

DATA_DIR    = Path(__file__).parent / "data"
OUTPUT_FILE = DATA_DIR / "calendar.json"
ENV_FILE    = Path(__file__).parent / ".env"

def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

# Top 10 economies by nominal GDP → ISO-2 country code: (display name, flag)
COUNTRIES = {
    "US": ("United States",  "🇺🇸"),
    "CN": ("China",          "🇨🇳"),
    "DE": ("Germany",        "🇩🇪"),
    "JP": ("Japan",          "🇯🇵"),
    "IN": ("India",          "🇮🇳"),
    "GB": ("United Kingdom", "🇬🇧"),
    "FR": ("France",         "🇫🇷"),
    "IT": ("Italy",          "🇮🇹"),
    "CA": ("Canada",         "🇨🇦"),
    "BR": ("Brazil",         "🇧🇷"),
}

HIGH_KEYWORDS = [
    "cpi", "consumer price index", "core cpi", "core pce", "pce deflator",
    "nonfarm", "non-farm", "payroll", "unemployment rate", "employment change",
    "fomc", "fed interest", "interest rate decision", "rate decision",
    "loan prime rate", "gdp", "gross domestic", "inflation rate", "inflation",
]

MEDIUM_KEYWORDS = [
    "ppi", "producer price", "retail sales", "ism manufacturing", "ism services",
    "ism non-manufacturing", "manufacturing pmi", "services pmi", "composite pmi",
    "caixin", "tankan", "ifo business", "zew", "housing starts", "building permits",
    "consumer confidence", "durable goods", "trade balance",
    "jobless claims", "initial claims", "industrial production",
    "consumer sentiment", "michigan",
]

EVENT_DISPLAY_NAMES = {
    "Nonfarm Payrolls":             "Non-Farm Payrolls (NFP)",
    "Unemployment Rate":            "Unemployment Rate",
    "CPI YoY":                      "CPI Inflation (YoY)",
    "CPI MoM":                      "CPI Inflation (MoM)",
    "Core CPI YoY":                 "Core CPI (YoY)",
    "GDP Growth Rate QoQ":          "GDP Growth (QoQ)",
    "GDP Growth Rate QoQ Adv":      "GDP Growth – Advance",
    "Fed Interest Rate Decision":   "FOMC Rate Decision",
    "FOMC Statement":               "FOMC Statement",
    "Retail Sales MoM":             "Retail Sales",
    "ISM Manufacturing PMI":        "ISM Manufacturing PMI",
    "ISM Non-Manufacturing PMI":    "ISM Services PMI",
    "PPI MoM":                      "PPI Inflation (MoM)",
    "Core PCE Price Index MoM":     "Core PCE Inflation",
    "Initial Jobless Claims":       "Jobless Claims",
    "Consumer Confidence":          "Consumer Confidence",
    "Michigan Consumer Sentiment":  "Consumer Sentiment (Michigan)",
}

def classify(name, api_impact):
    n = name.lower()
    if api_impact == "high" or any(k in n for k in HIGH_KEYWORDS):
        return "high"
    if api_impact == "medium" or any(k in n for k in MEDIUM_KEYWORDS):
        return "medium"
    return "low"

def fmt_value(val, unit):
    if val is None:
        return None
    unit = unit or ""
    try:
        v = float(val)
        if unit in ("%", "percent"):
            return f"{v:.1f}%"
        if abs(v) > 1_000_000:
            return f"{v/1_000_000:.2f}M"
        if abs(v) > 1_000:
            return f"{v:,.0f}K"
        return f"{v:.1f}"
    except:
        return str(val)

def main():
    env     = load_env()
    api_key = env.get("FINNHUB_API_KEY") or os.environ.get("FINNHUB_API_KEY", "")

    if not api_key:
        print("❌  FINNHUB_API_KEY not set.")
        print("   1. Register free at: https://finnhub.io")
        print("   2. Add to your .env file:")
        print("      FINNHUB_API_KEY=your_key_here")
        print("   3. Re-run this script.")
        return

    today   = datetime.today()
    from_dt = today.strftime("%Y-%m-%d")
    to_dt   = (today + timedelta(days=45)).strftime("%Y-%m-%d")

    print(f"📡  Fetching economic calendar ({from_dt} → {to_dt})…")

    try:
        resp = requests.get(
            "https://finnhub.io/api/v1/calendar/economic",
            params={"from": from_dt, "to": to_dt, "token": api_key},
            timeout=15,
        )
        resp.raise_for_status()
        raw = resp.json().get("economicCalendar", [])
    except requests.HTTPError as e:
        print(f"❌  Finnhub API error: {e}")
        return
    except Exception as e:
        print(f"❌  Network error: {e}")
        return

    events = []
    seen   = set()

    for e in sorted(raw, key=lambda x: x.get("time", "")):
        country = e.get("country", "").upper()
        if country not in COUNTRIES:
            continue

        name   = e.get("event", "")
        impact = classify(name, e.get("impact", "low"))
        if impact == "low":
            continue

        dt_raw = e.get("time", "")
        try:
            dt         = datetime.strptime(dt_raw[:10], "%Y-%m-%d")
            label      = dt.strftime("%a, %b %d")
            days_until = (dt - today).days
        except:
            label, days_until = dt_raw[:10], None

        key = (country, dt_raw[:10], name[:25])
        if key in seen:
            continue
        seen.add(key)

        unit          = e.get("unit", "")
        display       = EVENT_DISPLAY_NAMES.get(name, name)
        country_name, flag = COUNTRIES[country]

        events.append({
            "name":         display,
            "country":      country,
            "country_name": country_name,
            "flag":         flag,
            "date":         dt_raw[:10],
            "time":         dt_raw[11:16] if len(dt_raw) > 10 else "",
            "label":        label,
            "days_until":   days_until,
            "impact":       impact,
            "actual":       fmt_value(e.get("actual"),   unit),
            "estimate":     fmt_value(e.get("estimate"), unit),
            "prev":         fmt_value(e.get("prev"),     unit),
            "unit":         unit,
        })

    output = {
        "last_updated": today.strftime("%Y-%m-%d"),
        "countries":    [{"code": c, "name": n, "flag": f} for c, (n, f) in COUNTRIES.items()],
        "events":       events[:60],
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    high_count = sum(1 for e in events if e["impact"] == "high")
    med_count  = sum(1 for e in events if e["impact"] == "medium")
    print(f"✅  {len(events)} events saved  ({high_count} high · {med_count} medium)")
    print(f"   Saved → {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
