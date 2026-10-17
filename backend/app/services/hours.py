"""Opening-hours check using Google Places API (New).

RULE: Google is used ONLY for opening hours. The field mask requests nothing but
`regularOpeningHours`, we never use Google names/coordinates, and nothing from Google is
stored in the database (looked up fresh per generation, held in memory only).

No key configured -> this module is skipped and Gemini's statuses stand.
"""
import datetime as dt
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import httpx

from ..config import get_settings

log = logging.getLogger("app.hours")

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = "places.regularOpeningHours"  # hours only: do not add fields
WEEK = 7 * 24 * 60
_SEARCH_BOX_DEG = 0.005  # ~500m around the stop's coordinates


@dataclass(frozen=True)
class Stop:
    name: str
    lat: float | None
    lng: float | None
    city: str = ""  # the day's city on multi-city trips; falls back to the trip destination


@dataclass
class Hours:
    intervals: list[tuple[int, int]]  # [open, close) in minutes since Sunday 00:00
    descriptions: list[str]           # Google's weekdayDescriptions, Monday first


def enabled() -> bool:
    return bool(get_settings().google_maps_api_key)


# --- Pure logic (unit-tested) -------------------------------------------------

def parse_hours(regular: dict | None) -> Hours | None:
    """Google `regularOpeningHours` -> Hours. Days: 0 = Sunday."""
    if not regular or not regular.get("periods"):
        return None
    intervals = []
    for p in regular["periods"]:
        o = p.get("open")
        if o is None:
            continue
        c = p.get("close")
        if c is None:  # open 24/7
            intervals.append((0, WEEK))
            continue
        start = o["day"] * 1440 + o.get("hour", 0) * 60 + o.get("minute", 0)
        end = c["day"] * 1440 + c.get("hour", 0) * 60 + c.get("minute", 0)
        if end <= start:  # wraps past Saturday night
            end += WEEK
        intervals.append((start, end))
    return Hours(intervals, regular.get("weekdayDescriptions") or [])


def is_open_for_visit(hours: Hours, date: dt.date, start_hhmm: str, duration_mins: int) -> bool:
    """True if the whole visit [start, start + duration] falls inside one opening interval."""
    h, m = map(int, start_hhmm.split(":"))
    weekday = (date.weekday() + 1) % 7  # Python Mon=0 -> Google Sun=0
    vs = weekday * 1440 + h * 60 + m
    ve = vs + max(duration_mins, 0)
    for a, b in hours.intervals:
        for shift in (0, WEEK):  # intervals that wrap past Saturday
            if a <= vs + shift and ve + shift <= b:
                return True
    return False


def describe_day(hours: Hours, date: dt.date) -> str:
    i = date.weekday()  # weekdayDescriptions start on Monday
    return hours.descriptions[i] if i < len(hours.descriptions) else "hours unknown"


# --- Google call --------------------------------------------------------------

def _fetch(stop: Stop, destination: str) -> Hours | None:
    if stop.lat is None or stop.lng is None:
        return None  # without coordinates we can't be sure we'd match the right venue
    d = _SEARCH_BOX_DEG
    t0 = time.perf_counter()
    try:
        r = httpx.post(
            SEARCH_URL,
            headers={"X-Goog-Api-Key": get_settings().google_maps_api_key, "X-Goog-FieldMask": FIELD_MASK},
            json={
                "textQuery": f"{stop.name}, {stop.city or destination}",
                "pageSize": 1,
                "languageCode": "en",
                "locationRestriction": {"rectangle": {
                    "low": {"latitude": stop.lat - d, "longitude": stop.lng - d},
                    "high": {"latitude": stop.lat + d, "longitude": stop.lng + d},
                }},
            },
            timeout=5.0,
        )
        r.raise_for_status()
        places = r.json().get("places") or []
        hours = parse_hours(places[0].get("regularOpeningHours")) if places else None
        log.info("places hours %r -> %s %.0fms", stop.name, "found" if hours else "none", (time.perf_counter() - t0) * 1000)
        return hours
    except Exception as e:
        log.warning("places hours failed %r: %s %.0fms", stop.name, e, (time.perf_counter() - t0) * 1000)
        return None


def lookup_all(stops: set[Stop], destination: str) -> dict[Stop, Hours | None]:
    """Fetch hours for every distinct stop in parallel."""
    if not stops:
        return {}
    stops = list(stops)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = pool.map(lambda s: _fetch(s, destination), stops)
    return dict(zip(stops, results))
