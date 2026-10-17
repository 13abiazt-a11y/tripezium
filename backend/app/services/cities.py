"""Real-city check for trip routes.

Uses the SAME per-country lists as the front end's city dropdown
(frontend/public/cities/<CC>.json: GeoNames via all-the-cities, population >= 1,000, plus popular
places), so the API accepts exactly what the dropdown offers. Matching mirrors the front end's
search: accents and case are ignored, and the list's own spelling is returned ("kyoto" -> "Kyoto").

If a country has no list (or the folder is missing), its cities aren't checked: better to accept a
real trip than to block it on missing data. That's logged once per country.
"""
import json
import logging
from functools import lru_cache
from pathlib import Path

log = logging.getLogger("app.cities")

# backend/app/services/cities.py -> repo root -> frontend/public/cities
CITIES_DIR = Path(__file__).resolve().parents[3] / "frontend" / "public" / "cities"


def norm(s: str) -> str:
    """Same as the front end's norm(): NFD, drop combining accents (U+0300-U+036F), lower-case, trim."""
    import unicodedata
    decomposed = unicodedata.normalize("NFD", s)
    return "".join(c for c in decomposed if not "̀" <= c <= "ͯ").lower().strip()


@lru_cache(maxsize=300)
def _index(country: str) -> dict[str, str] | None:
    path = CITIES_DIR / f"{country.upper()}.json"
    if not path.is_file():
        log.warning("no city list for %s at %s; its cities won't be checked", country, path)
        return None
    names = json.loads(path.read_text(encoding="utf-8"))
    index: dict[str, str] = {}
    for name in names:  # lists are most-popular first, so the first spelling wins
        index.setdefault(norm(name), name)
    return index


def canonical_city(country: str, city: str) -> str | None:
    """The list's spelling of `city` in `country`; None if it isn't a known place there.
    Returns `city` unchanged when there's no list to check against."""
    index = _index(country)
    if index is None:
        return city.strip()
    return index.get(norm(city))
