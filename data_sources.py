"""
Brick Street — Licensed Data Layer (Finnhub)

A single, licensed provider abstraction. This replaces the legacy scraping
path with proper API calls:

  - scraper.py        (MarketBeat scraping) → Finnhub /stock/recommendation
  - fetch_prices.py   (Yahoo unofficial)    → Finnhub /quote
  - fetch_earnings.py (yfinance)            → Finnhub /stock/earnings

All stock data therefore comes from ONE source — Finnhub — under a commercial
licence. FRED (Fed rate) stays as-is because it is public domain.

⚠️  COMMERCIAL USE / REDISTRIBUTION
A public, paywalled site that *displays* this data to your own users counts as
redistribution. Finnhub's free tier is for personal / non-commercial use only.
Before going live you must be on a Finnhub plan that grants commercial use with
redistribution rights. See LICENSING.md for the checklist.

Requires FINNHUB_API_KEY in .env (or the environment).
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import requests

FINNHUB_BASE = "https://finnhub.io/api/v1"
ENV_FILE = Path(__file__).parent / ".env"


def load_env() -> dict:
    """Read simple KEY=VALUE pairs from .env (does not override real env vars)."""
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_finnhub_key() -> str:
    env = load_env()
    return os.environ.get("FINNHUB_API_KEY") or env.get("FINNHUB_API_KEY", "")


class FinnhubError(Exception):
    pass


class Finnhub:
    """Thin, rate-limit-aware Finnhub client returning Brick Street shapes."""

    def __init__(self, api_key: str | None = None, calls_per_min: int = 55):
        self.api_key = api_key or get_finnhub_key()
        if not self.api_key:
            raise FinnhubError(
                "FINNHUB_API_KEY is not set.\n"
                "  1. Sign up / log in at https://finnhub.io\n"
                "  2. For a public paid site, confirm your plan allows commercial "
                "use with redistribution (see LICENSING.md)\n"
                "  3. Add to .env:  FINNHUB_API_KEY=your_key_here"
            )
        # Free tier allows 60 calls/min; stay just under to be safe.
        self.min_interval = 60.0 / max(1, calls_per_min)
        self._last_call = 0.0
        self._session = requests.Session()

    # ── core request with rate limiting + 429 backoff ──────────
    def _get(self, path: str, **params):
        wait = self.min_interval - (time.time() - self._last_call)
        if wait > 0:
            time.sleep(wait)

        params["token"] = self.api_key
        last_exc = None
        for attempt in range(4):
            try:
                r = self._session.get(f"{FINNHUB_BASE}{path}", params=params, timeout=15)
            except requests.RequestException as e:
                last_exc = e
                time.sleep(1.5 * (attempt + 1))
                continue
            finally:
                self._last_call = time.time()

            if r.status_code == 429:  # rate limited — exponential backoff
                time.sleep(2 ** attempt)
                continue
            if r.status_code in (401, 403):
                raise FinnhubError(
                    f"{r.status_code} for {path} — your API key may be invalid, or "
                    f"your plan does not include this endpoint / commercial use. "
                    f"Response: {r.text[:200]}"
                )
            r.raise_for_status()
            return r.json()

        raise FinnhubError(f"Failed after retries on {path}: {last_exc or 'rate limited'}")

    # ── analyst consensus (replaces MarketBeat) ────────────────
    def recommendation(self, symbol: str):
        """Latest analyst consensus → {buy, hold, sell, period} or None.

        Finnhub returns strongBuy/buy/hold/sell/strongStrongSell per month.
        We collapse to the Buy/Hold/Sell shape the filter and website expect.
        """
        data = self._get("/stock/recommendation", symbol=symbol)
        if not data:
            return None
        latest = data[0]  # most recent period first
        buy = (latest.get("strongBuy") or 0) + (latest.get("buy") or 0)
        hold = latest.get("hold") or 0
        sell = (latest.get("sell") or 0) + (latest.get("strongSell") or 0)
        return {"buy": buy, "hold": hold, "sell": sell, "period": latest.get("period")}

    # ── live price (replaces Yahoo unofficial endpoint) ────────
    def quote(self, symbol: str):
        """Current price as a float, or None."""
        d = self._get("/quote", symbol=symbol)
        c = d.get("c")
        return round(float(c), 2) if c else None

    # ── EPS earnings surprise (replaces yfinance) ──────────────
    def earnings(self, symbol: str, quarters: int = 4):
        """Last `quarters` of EPS surprise % → [{quarter, surprise}] or None.

        Finnhub's surprisePercent is already a percentage (e.g. 4.1 == 4.1%),
        so unlike yfinance we do NOT multiply by 100.
        """
        data = self._get("/stock/earnings", symbol=symbol)
        if not data:
            return None
        rows = list(reversed(data))[-quarters:]  # oldest → newest
        out = []
        for row in rows:
            sp = row.get("surprisePercent")
            period = row.get("period") or ""
            if sp is None:
                continue
            out.append({"quarter": period[:7], "surprise": round(float(sp), 1)})
        return out or None

    # ── per-stock detail panel (replaces the Yahoo /api/quote proxy) ──
    def quote_raw(self, symbol: str) -> dict:
        """Raw quote dict: c=current, pc=previous close, etc."""
        return self._get("/quote", symbol=symbol)

    def company_name(self, symbol: str):
        try:
            d = self._get("/stock/profile2", symbol=symbol)
            return d.get("name")
        except FinnhubError:
            return None

    def recommendation_mean(self, symbol: str):
        """(mean 1–5, total analysts) Yahoo-style, or (None, 0).
        1=Strong Buy … 5=Strong Sell, computed from the consensus counts."""
        data = self._get("/stock/recommendation", symbol=symbol)
        if not data:
            return None, 0
        r = data[0]
        weights = {"strongBuy": 1, "buy": 2, "hold": 3, "sell": 4, "strongSell": 5}
        total = sum((r.get(k) or 0) for k in weights)
        if not total:
            return None, 0
        mean = sum((r.get(k) or 0) * w for k, w in weights.items()) / total
        return round(mean, 2), total

    def price_target(self, symbol: str):
        """{low, mean, high} or None. Premium endpoint — None on free tier."""
        try:
            d = self._get("/stock/price-target", symbol=symbol)
        except FinnhubError:
            return None
        if not d or not d.get("targetMean"):
            return None
        return {"low": d.get("targetLow"), "mean": d.get("targetMean"), "high": d.get("targetHigh")}

    def daily_closes(self, symbol: str, days: int = 90) -> list:
        """Up to `days` of daily closing prices. Premium (/stock/candle) on
        current Finnhub plans — returns [] gracefully if not available."""
        to_ts = int(time.time())
        from_ts = to_ts - days * 86400
        try:
            d = self._get("/stock/candle", symbol=symbol, resolution="D",
                          **{"from": from_ts, "to": to_ts})
        except FinnhubError:
            return []
        if d.get("s") == "ok":
            return [c for c in (d.get("c") or []) if c is not None]
        return []

    # ── S&P 500 membership (premium endpoint; orchestrator falls back) ──
    def sp500_symbols(self) -> list:
        """S&P 500 constituents. Requires a paid plan; raises otherwise so the
        orchestrator can fall back to the bundled local list."""
        data = self._get("/index/constituents", symbol="^GSPC")
        return data.get("constituents") or []
