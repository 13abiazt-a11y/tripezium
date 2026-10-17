"""Importer caches: memory first, then Tiger Data (import_cache / geocode_cache tables).

Pre-importing the demo videos fills these, so they stay instant after a restart or redeploy.
A database problem never breaks an import: it's logged and treated as a cache miss.
"""
import logging

from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..config import get_settings
from ..db import _session_factory
from ..models import GeocodeCacheRow, ImportCacheRow
from ..schemas import PlaceIn

log = logging.getLogger("app.import_cache")

MISS = object()  # distinguishes "not cached" from a cached "Nominatim found nothing" (None)

_places: dict[str, list[PlaceIn]] = {}
_geocodes: dict[tuple[str, str], dict | None] = {}


def _db_enabled() -> bool:
    return bool(get_settings().database_url)


def clear_memory() -> None:
    _places.clear()
    _geocodes.clear()


def _upsert(row_cls, values: dict, key_cols: list[str], what: str) -> None:
    if not _db_enabled():
        return
    try:
        stmt = pg_insert(row_cls).values(**values)
        stmt = stmt.on_conflict_do_update(index_elements=key_cols,
                                          set_={c: stmt.excluded[c] for c in values if c not in key_cols})
        with _session_factory()() as db:
            db.execute(stmt)
            db.commit()
    except Exception as e:
        log.warning("couldn't save %s to the database: %s", what, e)


def _load(row_cls, key, what: str):
    if not _db_enabled():
        return None
    try:
        with _session_factory()() as db:
            return db.get(row_cls, key)
    except Exception as e:
        log.warning("couldn't read %s from the database: %s", what, e)
        return None


# --- Gemini results, per video / post / text / image set -------------------

def get_places(key: str) -> list[PlaceIn] | None:
    if key in _places:
        return _places[key]
    row = _load(ImportCacheRow, key, f"import {key}")
    if row is None:
        return None
    places = [PlaceIn.model_validate(p) for p in row.places]
    _places[key] = places
    return places


def put_places(key: str, places: list[PlaceIn]) -> None:
    _places[key] = places
    # area/city are excluded from normal dumps (not in the API), but the geocoder needs them back.
    data = [{**p.model_dump(mode="json"), "area": p.area, "city": p.city} for p in places]
    _upsert(ImportCacheRow, {"cache_key": key, "places": data}, ["cache_key"], f"import {key}")


# --- Nominatim results, per query ------------------------------------------

def get_geocode(query: str, country_code: str | None):
    """Cached {"lat","lng","country_code"}, None (known not found), or MISS."""
    key = (query.strip().lower(), country_code or "")
    if key in _geocodes:
        return _geocodes[key]
    row = _load(GeocodeCacheRow, key, f"geocode {key[0]!r}")
    if row is None:
        return MISS
    _geocodes[key] = row.result
    return row.result


def put_geocode(query: str, country_code: str | None, result: dict | None) -> None:
    key = (query.strip().lower(), country_code or "")
    _geocodes[key] = result
    _upsert(GeocodeCacheRow, {"query": key[0], "country_code": key[1], "result": result},
            ["query", "country_code"], f"geocode {key[0]!r}")
