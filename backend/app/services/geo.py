"""Destination -> (country code, local currency).

Resolved once on POST /trips and stored on the trip. If anything fails the trip still
saves; holidays and currency are then skipped or defaulted downstream.
"""
import logging
import math
import re
import threading
import time

import httpx

from ..config import get_settings

log = logging.getLogger("app.geo")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

COUNTRY_CURRENCY = {
    "JP": "JPY", "KR": "KRW", "CN": "CNY", "HK": "HKD", "TW": "TWD", "SG": "SGD",
    "TH": "THB", "VN": "VND", "ID": "IDR", "MY": "MYR", "PH": "PHP", "IN": "INR",
    "AE": "AED", "TR": "TRY", "MA": "MAD", "EG": "EGP", "ZA": "ZAR", "KE": "KES",
    "GB": "GBP", "IE": "EUR", "FR": "EUR", "ES": "EUR", "IT": "EUR", "PT": "EUR",
    "DE": "EUR", "NL": "EUR", "BE": "EUR", "AT": "EUR", "GR": "EUR", "FI": "EUR",
    "HR": "EUR", "CH": "CHF", "NO": "NOK", "SE": "SEK", "DK": "DKK", "IS": "ISK",
    "PL": "PLN", "CZ": "CZK", "HU": "HUF", "US": "USD", "CA": "CAD", "MX": "MXN",
    "BR": "BRL", "AR": "ARS", "CL": "CLP", "CO": "COP", "PE": "PEN", "AU": "AUD",
    "NZ": "NZD",
}

_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")

# Nominatim usage policy: max 1 request/second, identifying User-Agent.
_nominatim_lock = threading.Lock()
_last_call = 0.0
_cache: dict[str, str | None] = {}


def lookup_country_code(destination: str) -> str | None:
    key = destination.strip().lower()
    if key in _cache:
        return _cache[key]

    global _last_call
    with _nominatim_lock:
        wait = 1.0 - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        t0 = time.perf_counter()
        try:
            r = httpx.get(
                NOMINATIM_URL,
                params={"q": destination, "format": "jsonv2", "limit": 1, "addressdetails": 1},
                headers={"User-Agent": get_settings().nominatim_user_agent},
                timeout=5.0,
            )
            r.raise_for_status()
            results = r.json()
            code = results[0]["address"]["country_code"].upper() if results else None
            log.info("nominatim ok q=%r country=%s %.0fms", destination, code, (time.perf_counter() - t0) * 1000)
        except Exception as e:
            log.warning("nominatim failed q=%r %s %.0fms", destination, e, (time.perf_counter() - t0) * 1000)
            return None  # don't cache failures; next trip can retry
        finally:
            _last_call = time.monotonic()

    _cache[key] = code
    return code


# --- Place geocoding (video import) -----------------------------------------

_geo_cache: dict[tuple[str, str | None], dict | None] = {}


def geocode(query: str, country_code: str | None = None) -> dict | None:
    """Free-text query -> {"lat", "lng", "country_code"} or None. Same 1 req/s limit as above."""
    key = (query.strip().lower(), country_code)
    if key in _geo_cache:
        return _geo_cache[key]

    params = {"q": query, "format": "jsonv2", "limit": 1, "addressdetails": 1}
    if country_code:
        params["countrycodes"] = country_code.lower()

    global _last_call
    with _nominatim_lock:
        wait = 1.0 - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            r = httpx.get(NOMINATIM_URL, params=params,
                          headers={"User-Agent": get_settings().nominatim_user_agent}, timeout=5.0)
            r.raise_for_status()
            results = r.json()
        except Exception as e:
            log.warning("nominatim geocode failed q=%r %s", query, e)
            return None  # don't cache failures
        finally:
            _last_call = time.monotonic()

    hit = None
    if results:
        top = results[0]
        hit = {"lat": float(top["lat"]), "lng": float(top["lon"]),
               "country_code": (top.get("address", {}).get("country_code") or "").upper() or None}
    _geo_cache[key] = hit
    return hit


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def _currency_from_gemini(country_code: str) -> str | None:
    s = get_settings()
    if not (s.gemini_api_key and s.gemini_model):
        return None
    from google import genai
    from google.genai import types

    t0 = time.perf_counter()
    try:
        client = genai.Client(api_key=s.gemini_api_key, http_options=types.HttpOptions(timeout=15_000))
        resp = client.models.generate_content(
            model=s.gemini_model,
            contents=f"What is the ISO 4217 currency code used in the country with ISO 3166 code "
                     f"{country_code}? Reply with only the 3-letter code.",
        )
        code = (resp.text or "").strip().upper()
        ok = bool(_CURRENCY_RE.match(code))
        log.info("gemini currency country=%s -> %r valid=%s %.0fms", country_code, code, ok, (time.perf_counter() - t0) * 1000)
        return code if ok else None
    except Exception as e:
        log.warning("gemini currency failed country=%s %s", country_code, e)
        return None


def currency_for(country_code: str | None) -> str | None:
    if not country_code:
        return None
    return COUNTRY_CURRENCY.get(country_code) or _currency_from_gemini(country_code)


def resolve_destination(destination: str) -> tuple[str | None, str | None]:
    country = lookup_country_code(destination)
    currency = currency_for(country)
    if country is None or currency is None:
        log.warning("destination %r resolved partially: country=%s currency=%s", destination, country, currency)
    return country, currency
