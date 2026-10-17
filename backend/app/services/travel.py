"""Travel time between consecutive stops, and fitting a day's times around it.

Deterministic estimates from coordinates only (no routing API: Google is hours-only, and the
demo can't depend on another external service). Good enough to stop the plan teleporting
people across the city; shown to users as approximate ("~25 min").
"""
import math
from dataclasses import dataclass

DETOUR = 1.3              # streets aren't straight lines
WALK_KMH = 4.5
WALK_MAX_KM = 1.5         # beyond this, take transport...
WALK_MAX_MINS = 25        # ...unless walking is still this quick
TRANSIT_OVERHEAD = 10     # walk to the station + wait
TRANSIT_KMH = 25          # city metro/bus including stops
TRAIN_FROM_KM = 40        # day trips (e.g. Tokyo -> Hakone)
TRAIN_OVERHEAD = 20
TRAIN_KMH = 80
STEP = 5                  # times are planned in 5-minute steps


@dataclass(frozen=True)
class Leg:
    mode: str   # walk | transit | train
    mins: int   # rounded up to STEP
    km: float   # estimated travel distance


@dataclass
class Stop:
    time: str           # "HH:MM" planned start
    duration: int       # minutes
    lat: float | None
    lng: float | None


def hm(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def fmt(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _round_up(mins: float) -> int:
    return max(STEP, math.ceil(mins / STEP) * STEP)


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def estimate(a: Stop, b: Stop) -> Leg | None:
    """Getting from stop a to stop b. None if either has no coordinates."""
    if None in (a.lat, a.lng, b.lat, b.lng):
        return None
    km = distance_km(a.lat, a.lng, b.lat, b.lng) * DETOUR
    walk = km / WALK_KMH * 60
    if km <= WALK_MAX_KM:
        return Leg("walk", _round_up(walk), round(km, 1))
    if km <= TRAIN_FROM_KM:
        transit = TRANSIT_OVERHEAD + km / TRANSIT_KMH * 60
        if walk <= WALK_MAX_MINS and walk <= transit:
            return Leg("walk", _round_up(walk), round(km, 1))
        return Leg("transit", _round_up(transit), round(km, 1))
    return Leg("train", _round_up(TRAIN_OVERHEAD + km / TRAIN_KMH * 60), round(km, 1))


def fit_day(stops: list[Stop]) -> tuple[list[str], list[Leg | None]]:
    """Push stops later where there isn't time to get there. Never moves anything earlier.

    Returns the new start times and the leg into each stop (None for the first stop of the day,
    or when coordinates are missing: then that gap is left as planned).
    """
    times, legs = [], []
    prev_end = None
    prev = None
    for s in stops:
        start = hm(s.time)
        leg = estimate(prev, s) if prev is not None else None
        if prev_end is not None:
            earliest = prev_end + (leg.mins if leg else 0)
            if start < earliest:
                start = math.ceil(earliest / STEP) * STEP
        times.append(fmt(start))
        legs.append(leg)
        prev_end, prev = start + s.duration, s
    return times, legs
