"""FX rates: cache (fx_rates hypertable) -> live source -> hardcoded fallback.

Live source is Wise (FX_SOURCE=wise + WISE_API_TOKEN) or Frankfurter (ECB reference rates).
Every Wise rate is sanity-checked against the market rate before use: if it differs by more
than MAX_WISE_DEVIATION we don't use it. The demo must never break or show a nonsense number
because an API is flaky, so get_rate() always returns something.
"""
import datetime as dt
import logging
import time
from decimal import Decimal

import httpx
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import fx_rates

log = logging.getLogger("app.fx")

FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
WISE_SANDBOX_URL = "https://api.wise-sandbox.com"  # moved from api.sandbox.transferwise.tech (now 410 Gone)
CACHE_TTL = dt.timedelta(hours=6)

MAX_WISE_DEVIATION = Decimal("0.03")      # vs the market (ECB) rate
MAX_FALLBACK_DEVIATION = Decimal("0.15")  # vs our approximate table, when there's no market rate

# Units of each currency per 1 GBP. Snapshot of ECB reference rates via Frankfurter, 2026-10-16.
# Only used if the cache and live sources all fail; other pairs are derived as cross rates.
FALLBACK_PER_GBP = {
    "GBP": "1", "AUD": "1.9163", "BRL": "6.7781", "CAD": "1.8884", "CHF": "1.0988", "CNY": "8.9163",
    "CZK": "28.824", "DKK": "8.858", "EUR": "1.185", "HKD": "10.4658", "HUF": "430.27", "IDR": "24045",
    "ILS": "4.1266", "INR": "126.63", "ISK": "161.4", "JPY": "210.72", "KRW": "1776.39", "MXN": "24.515",
    "MYR": "5.4428", "NOK": "12.5899", "NZD": "2.3544", "PHP": "83.97", "PLN": "5.1786", "RON": "6.3175",
    "SEK": "13.2073", "SGD": "1.7059", "THB": "44.56", "TRY": "66.046", "USD": "1.3335", "ZAR": "21.915",
}


def fallback_rate(base: str, quote: str) -> Decimal | None:
    b, q = FALLBACK_PER_GBP.get(base), FALLBACK_PER_GBP.get(quote)
    if b is None or q is None:
        return None
    return Decimal(q) / Decimal(b)


# --- Live sources -------------------------------------------------------------

def _timed(name: str, base: str, quote: str, fn) -> Decimal | None:
    t0 = time.perf_counter()
    try:
        rate = fn()
        log.info("%s rate %s->%s = %s %.0fms", name, base, quote, rate, (time.perf_counter() - t0) * 1000)
        return rate
    except Exception as e:
        log.warning("%s rate %s->%s failed: %s %.0fms", name, base, quote, e, (time.perf_counter() - t0) * 1000)
        return None


def fetch_market(base: str, quote: str) -> Decimal | None:
    """Frankfurter / ECB reference rate. No key needed.

    Fetched as two EUR rates and divided: the ECB publishes against EUR to ~5 significant figures,
    whereas asking Frankfurter for e.g. JPY->GBP directly comes back rounded to 0.00475 (0.1% off).
    """
    def call():
        symbols = sorted({base, quote} - {"EUR"})
        r = httpx.get(FRANKFURTER_URL, params={"base": "EUR", "symbols": ",".join(symbols)}, timeout=5.0)
        r.raise_for_status()
        per_eur = {k: Decimal(str(v)) for k, v in r.json()["rates"].items()} | {"EUR": Decimal(1)}
        return per_eur[quote] / per_eur[base]
    return _timed("frankfurter", base, quote, call)


def fetch_wise(base: str, quote: str) -> Decimal | None:
    s = get_settings()
    if not s.wise_api_token:
        return None

    def call():
        r = httpx.get(
            f"{(s.wise_api_url or WISE_SANDBOX_URL).rstrip('/')}/v1/rates",
            params={"source": base, "target": quote},
            headers={"Authorization": f"Bearer {s.wise_api_token}"},
            timeout=5.0,
        )
        r.raise_for_status()
        return Decimal(str(r.json()[0]["rate"]))
    return _timed("wise", base, quote, call)


def _deviation(rate: Decimal, reference: Decimal) -> Decimal:
    return abs(rate - reference) / reference


def live_rate(base: str, quote: str) -> list[tuple[Decimal, str]]:
    """Fetch from the live source(s). Returns [(rate, source), ...]; the first one is the one to use.

    Every rate returned is also worth storing (the market rate is kept even when Wise wins, for history).
    """
    market = fetch_market(base, quote)
    if get_settings().fx_source != "wise":
        return [(market, "public")] if market else []

    wise = fetch_wise(base, quote)
    if wise is None:
        log.warning("fx: Wise unavailable for %s->%s, using market rate", base, quote)
        return [(market, "public")] if market else []

    if market is not None:
        dev = _deviation(wise, market)
        if dev > MAX_WISE_DEVIATION:
            log.warning("fx: REJECTED Wise %s->%s = %s, %.1f%% off market %s (limit %.0f%%)",
                        base, quote, wise, dev * 100, market, MAX_WISE_DEVIATION * 100)
            return [(market, "public")]
        return [(wise, "wise"), (market, "public")]

    # No market rate (e.g. currency not covered by the ECB): check against our approximate table.
    approx = fallback_rate(base, quote)
    if approx is not None and _deviation(wise, approx) > MAX_FALLBACK_DEVIATION:
        log.warning("fx: REJECTED Wise %s->%s = %s, %.1f%% off fallback %s and no market rate",
                    base, quote, wise, _deviation(wise, approx) * 100, approx)
        return []
    return [(wise, "wise")]


# --- Public API ---------------------------------------------------------------

def _cached(db: Session, base: str, quote: str) -> tuple[Decimal, str] | None:
    preferred = ["wise", "public"] if get_settings().fx_source == "wise" else ["public"]
    since = dt.datetime.now(dt.timezone.utc) - CACHE_TTL
    for source in preferred:
        row = db.execute(
            select(fx_rates.c.rate).where(
                fx_rates.c.base == base, fx_rates.c.quote == quote,
                fx_rates.c.source == source, fx_rates.c.time >= since,
            ).order_by(fx_rates.c.time.desc()).limit(1)
        ).first()
        if row is not None:
            return Decimal(str(row.rate)), source
    return None


def get_rate(db: Session, base: str, quote: str) -> tuple[Decimal | None, str]:
    """How many `quote` per 1 `base`. Returns (rate, source); rate is None only if nothing at all is known."""
    if base == quote:
        return Decimal(1), "same"

    try:
        hit = _cached(db, base, quote)
        if hit:
            return hit
    except Exception as e:
        db.rollback()
        log.warning("fx cache read failed %s->%s: %s", base, quote, e)

    # Round to what the DOUBLE PRECISION column stores, so a fresh rate equals its cached copy.
    fetched = [(Decimal(str(float(r))), src) for r, src in live_rate(base, quote)]
    if fetched:
        try:
            now = dt.datetime.now(dt.timezone.utc)
            db.execute(insert(fx_rates), [
                {"time": now, "base": base, "quote": quote, "rate": float(r), "source": src} for r, src in fetched
            ])
            db.commit()
        except Exception as e:
            db.rollback()
            log.warning("fx cache write failed %s->%s: %s", base, quote, e)
        return fetched[0]

    rate = fallback_rate(base, quote)
    if rate is not None:
        log.warning("fx: using FALLBACK rate %s->%s = %s", base, quote, rate)
        return rate, "fallback"
    log.error("fx: no rate at all for %s->%s", base, quote)
    return None, "none"
