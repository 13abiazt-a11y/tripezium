"""FX rates: cache (fx_rates hypertable) -> Frankfurter (ECB reference rates) -> hardcoded fallback.

The demo must never break or show a nonsense number because an API is flaky, so get_rate()
always returns something when the currency is known.
"""
import datetime as dt
import logging
import time
from decimal import Decimal

import httpx
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from ..models import fx_rates

log = logging.getLogger("app.fx")

FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
SOURCE = "public"  # value stored in fx_rates.source for live rates
CACHE_TTL = dt.timedelta(hours=6)

# Units of each currency per 1 GBP. Snapshot of ECB reference rates via Frankfurter, 2026-10-16.
# Only used if the cache and the live source both fail; other pairs are derived as cross rates.
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


def fetch_market(base: str, quote: str) -> Decimal | None:
    """Frankfurter / ECB reference rate. No key needed.

    Fetched as two EUR rates and divided: the ECB publishes against EUR to ~5 significant figures,
    whereas asking Frankfurter for e.g. JPY->GBP directly comes back rounded to 0.00475 (0.1% off).
    """
    t0 = time.perf_counter()
    try:
        symbols = sorted({base, quote} - {"EUR"})
        r = httpx.get(FRANKFURTER_URL, params={"base": "EUR", "symbols": ",".join(symbols)}, timeout=5.0)
        r.raise_for_status()
        per_eur = {k: Decimal(str(v)) for k, v in r.json()["rates"].items()} | {"EUR": Decimal(1)}
        rate = per_eur[quote] / per_eur[base]
        log.info("frankfurter rate %s->%s = %s %.0fms", base, quote, rate, (time.perf_counter() - t0) * 1000)
        return rate
    except Exception as e:
        log.warning("frankfurter rate %s->%s failed: %s %.0fms", base, quote, e, (time.perf_counter() - t0) * 1000)
        return None


def _cached(db: Session, base: str, quote: str) -> Decimal | None:
    since = dt.datetime.now(dt.timezone.utc) - CACHE_TTL
    row = db.execute(
        select(fx_rates.c.rate).where(
            fx_rates.c.base == base, fx_rates.c.quote == quote,
            fx_rates.c.source == SOURCE, fx_rates.c.time >= since,
        ).order_by(fx_rates.c.time.desc()).limit(1)
    ).first()
    return Decimal(str(row.rate)) if row is not None else None


def get_rate(db: Session, base: str, quote: str) -> tuple[Decimal | None, str]:
    """How many `quote` per 1 `base`. Returns (rate, source); rate is None only if nothing at all is known."""
    if base == quote:
        return Decimal(1), "same"

    try:
        hit = _cached(db, base, quote)
        if hit is not None:
            return hit, SOURCE
    except Exception as e:
        db.rollback()
        log.warning("fx cache read failed %s->%s: %s", base, quote, e)

    live = fetch_market(base, quote)
    if live is not None:
        live = Decimal(str(float(live)))  # what the DOUBLE PRECISION column stores, so fresh == cached
        try:
            db.execute(insert(fx_rates), [{
                "time": dt.datetime.now(dt.timezone.utc), "base": base, "quote": quote,
                "rate": float(live), "source": SOURCE,
            }])
            db.commit()
        except Exception as e:
            db.rollback()
            log.warning("fx cache write failed %s->%s: %s", base, quote, e)
        return live, SOURCE

    rate = fallback_rate(base, quote)
    if rate is not None:
        log.warning("fx: using FALLBACK rate %s->%s = %s", base, quote, rate)
        return rate, "fallback"
    log.error("fx: no rate at all for %s->%s", base, quote)
    return None, "none"
