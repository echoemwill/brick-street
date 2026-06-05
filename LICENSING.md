# Going Legit — Data Licensing & Compliance Checklist

This is the operational checklist to turn Brick Street from a personal project
into a public, paid product **without legal exposure**. Work top to bottom.

> ⚠️ Nothing here is legal advice. Have a lawyer review your Terms, Privacy
> Policy, and refund terms before you take a single payment — especially across
> the EU/UK/US.

---

## 1. Data sources — what changed and why

| Data | Old (personal-use only) | New (licensed) | Status |
|------|------------------------|----------------|--------|
| Analyst Buy/Hold/Sell | MarketBeat scraping ❌ | Finnhub `/stock/recommendation` | ✅ swapped (`data_sources.py`) |
| Live prices | Yahoo unofficial endpoint ❌ | Finnhub `/quote` | ✅ swapped |
| EPS earnings surprise | yfinance (Yahoo) ❌ | Finnhub `/stock/earnings` | ✅ swapped |
| Economic calendar | Finnhub free (non-commercial) ⚠️ | Finnhub (commercial plan) | ⚠️ needs paid plan |
| Fed funds rate | FRED ✅ | FRED ✅ (public domain) | ✅ keep as-is |

The legacy scrapers (`scraper.py`, `fetch_prices.py`, `fetch_earnings.py`) are
**deprecated** and now refuse to run unless `ALLOW_SCRAPING=1`. Do not use them
for the commercial site. The licensed path is **`fetch_stocks.py`**.

The live per-stock detail panel (`/api/quote` in `auth_server.py`) was **also
migrated off Yahoo to Finnhub**, so no unlicensed data is served to users
anywhere. On the free tier the price-history sparkline and exact analyst targets
stay empty (those Finnhub endpoints are premium); they light up on the paid plan.

---

## 2. The one thing only YOU can do: the Finnhub commercial licence

The free Finnhub tier is for **personal / non-commercial** use. A public,
paywalled site that *displays* the data to your users is **redistribution**, which
needs a commercial plan with display/redistribution rights.

- [ ] Log in to https://finnhub.io and review their **commercial / redistribution**
      pricing (the "startups & enterprise" tier).
- [ ] Confirm in writing (support/sales) that your plan covers:
      **commercial use** + **displaying data to your end users**.
- [ ] Confirm any **attribution** requirement (we already credit "Finnhub" in the
      site footer — adjust wording to match their exact requirement).
- [ ] Put the paid API key in `.env` as `FINNHUB_API_KEY`. No code change needed.

FRED requires no licence (U.S. government public-domain data) but a courtesy
credit is included in the footer.

---

## 3. Payments — never touch card data

Use a processor so you stay out of PCI scope:

- [ ] **Stripe**, or **Paddle / Lemon Squeezy** (these act as *merchant of record*
      and handle EU/US sales tax & VAT for you — strongly recommended for a solo
      operator).
- [ ] Add a `subscription_status` column to the `users` table and set it from the
      processor's **webhook** (do not trust the client).
- [ ] Gate premium API responses on `subscription_status == 'active'`.

---

## 4. Legal documents (drafts provided, lawyer review required)

- [ ] `website/legal.html` contains **Disclaimer**, **Terms of Service**, and
      **Privacy Policy** drafts. Replace every `[BRACKETED]` placeholder:
      legal name, jurisdiction, support email, price, refund policy, processor.
- [ ] Keep the **"not financial advice"** disclaimer visible (footer + legal page).
      This is what keeps you on the right side of investment-adviser rules — present
      the site as *information about what analysts say*, never as "you should buy X".
- [ ] Registration now requires ticking **"I agree to the Terms & Privacy Policy"**.
- [ ] Add a real **support email** and (if required in your country) a business
      address to the Terms/Privacy.

---

## 5. Security (already applied in `auth_server.py`)

- [x] JWT signing secret moved out of source code → `BS_SECRET` env var; server
      refuses to start in production without it (`BS_ENV=production`).
- [x] Brute-force rate limiting on `/api/auth/login` and `/register`.
- [x] `.env` and `data/users.db` are git-ignored.
- [x] **GDPR rights implemented in code** so the Privacy Policy's promises are real:
      `GET /api/auth/export` (download all your data) and
      `DELETE /api/auth/account` (permanent erasure) — both wired to a
      "Your data & privacy" panel in the members area.
- [x] **Production preflight** (`preflight_production_checks`) refuses to start in
      production if `legal.html` still has unfilled `[BRACKETED]` placeholders or
      no `FINNHUB_API_KEY` — you can't accidentally launch non-compliant.
- [ ] Before launch: set `BS_ENV=production`, a strong `BS_SECRET`
      (`python3 -c "import secrets;print(secrets.token_hex(32))"`), and
      `BS_ALLOWED_ORIGINS=https://yourdomain.com`.
- [ ] Serve over **HTTPS** (your host/CDN, e.g. Caddy, Nginx, Cloudflare, or the
      platform's built-in TLS). Never send login over plain HTTP.

---

## 6. Pre-launch smoke test

```bash
pip3 install -r requirements.txt
python3 fetch_stocks.py     # licensed analyst ratings + prices + earnings
python3 fetch_fed_rate.py   # FRED (public domain)
python3 fetch_calendar.py   # Finnhub calendar (needs commercial plan)
python3 auth_server.py      # serves site + auth at http://localhost:8080
```
