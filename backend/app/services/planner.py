"""The itinerary pipeline: holidays -> Gemini -> opening-hours check (+ one fix pass) -> closure check -> save.

Kept separate from the router so the Sunday chat-edit endpoint can reuse the same steps.
"""
import datetime as dt
import logging
import time

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..ids import new_id
from ..models import ItineraryRow, PlaceRow, TripRow
from ..schemas import Itinerary, ItineraryDay, ItineraryItem
from . import budget, fx, gemini, hours, route, travel
from .holidays import Holiday, apply_closure_check, get_holidays

log = logging.getLogger("app.planner")

# Hours verdict per item: "open" | "closed" | "unknown" (no hours found), or None when the check is off.
Verdicts = list[list[str | None]]


def _valid_coords(lat: float | None, lng: float | None) -> bool:
    return lat is not None and lng is not None and -90 <= lat <= 90 and -180 <= lng <= 180


def _stop(item: gemini.GItem, imported: dict[str, PlaceRow], city: str = "") -> hours.Stop:
    if item.placeId is not None:
        p = imported[item.placeId]
        if p.lat is None and _valid_coords(item.placeLat, item.placeLng):
            return hours.Stop(p.name, item.placeLat, item.placeLng, city)  # Gemini placed it for us
        return hours.Stop(p.name, p.lat, p.lng, city)
    np = item.newPlace
    return hours.Stop(np.name, np.lat, np.lng, city)


def _city_by_date(trip: TripRow) -> dict[str, str]:
    """ISO date -> that day's city. Empty for single-destination trips (the trip destination is used)."""
    if not route.is_multi_city(trip):
        return {}
    return {d.isoformat(): leg.city for d, leg in route.day_legs(trip)}


def trip_holidays(db: Session, trip: TripRow) -> list[Holiday]:
    """Each country's public holidays, only on the dates the traveller is in that country."""
    by_country: dict[str | None, list[dt.date]] = {}
    for d, leg in route.day_legs(trip):
        by_country.setdefault(leg.country, []).append(d)
    several = len(by_country) > 1
    out = []
    for country, dates in by_country.items():
        for h in get_holidays(db, country, min(dates), max(dates)):
            if h.date in dates:
                out.append(Holiday(h.date, f"{h.name} ({country})" if several else h.name))
    return sorted(out, key=lambda h: h.date)


# Travel leg into each item (None for the first stop of a day, or without coordinates).
Legs = list[list[travel.Leg | None]]


def fit_travel(trip: TripRow, plan: gemini.GItinerary, imported: dict[str, PlaceRow]) -> tuple[Legs, list[str]]:
    """Push stops later where there isn't time to travel between them (changes item times in place).

    Returns the legs, plus a line per day that now runs past the trip's day end, for the fix pass.
    """
    day_end = trip.day_end.hour * 60 + trip.day_end.minute
    legs: Legs = []
    too_long: list[str] = []
    for day in plan.days:
        stops = []
        for item in day.items:
            s = _stop(item, imported)
            stops.append(travel.Stop(item.time, item.durationMins, s.lat, s.lng))
        times, day_legs = travel.fit_day(stops)
        for item, t in zip(day.items, times):
            item.time = t
        legs.append(day_legs)
        if day.items:
            ends = travel.hm(times[-1]) + day.items[-1].durationMins
            if ends > day_end:
                too_long.append(f"{day.date}: with travel between stops the day runs until {travel.fmt(ends)}, "
                                f"past {travel.fmt(day_end)}")
    return legs, too_long


def missing_saved_places(plan: gemini.GItinerary, imported: dict[str, PlaceRow]) -> list[str]:
    """Imported places (what the user actually wants) that Gemini left out, as lines for the fix prompt."""
    used = {i.placeId for d in plan.days for i in d.items}
    return [f"{p.name_english or p.name} (placeId {pid})" for pid, p in imported.items() if pid not in used]


def _name(item: gemini.GItem, imported: dict[str, PlaceRow]) -> str:
    if item.placeId is not None:
        p = imported[item.placeId]
        return p.name_english or p.name
    return item.newPlace.nameEnglish or item.newPlace.name


def check_hours(trip: TripRow, plan: gemini.GItinerary, imported: dict[str, PlaceRow]) -> tuple[Verdicts, list[str]]:
    """Check every item against opening hours. Returns verdicts and human-readable 'closed' lines for Gemini."""
    on = hours.enabled()
    city = _city_by_date(trip)
    found = hours.lookup_all({_stop(i, imported, city.get(d.date, "")) for d in plan.days for i in d.items},
                             trip.destination) if on else {}

    verdicts: Verdicts = []
    closed: list[str] = []
    for day in plan.days:
        date = dt.date.fromisoformat(day.date)
        row = []
        for item in day.items:
            verdict = None
            if on:
                h = found.get(_stop(item, imported, city.get(day.date, "")))
                if h is None:
                    verdict = "unknown"
                elif hours.is_open_for_visit(h, date, item.time, item.durationMins):
                    verdict = "open"
                else:
                    verdict = "closed"
                    closed.append(f"{day.date} {item.time} {_name(item, imported)} ({item.durationMins} min). "
                                  f"Opening hours: {hours.describe_day(h, date)}")
            if verdict is None and item.status == "closed":
                closed.append(f"{day.date} {item.time} {_name(item, imported)}: you marked it as closed")
            row.append(verdict)
        verdicts.append(row)
    return verdicts, closed


# Streets, crossings and parks have no opening hours; "no hours on Google" is expected, not a warning sign.
OPEN_AIR = {"landmark", "park"}


def final_status(gemini_status: str, verdict: str | None, category: str | None = None) -> str:
    """Opening hours can only make a status MORE cautious, never less.

    Google's weekly hours can't see seasonal closures (e.g. a museum shut 26 Dec - 1 Jan still
    shows its normal Thursday hours), so "open" never upgrades Gemini's check_hours/closed.
    """
    if verdict == "closed":
        return "closed"
    if verdict == "unknown" and gemini_status == "ok" and (category or "").lower() not in OPEN_AIR:
        return "check_hours"  # no hours on Google: don't claim it's open
    return gemini_status


def _to_itinerary(
    db: Session, trip: TripRow, plan: gemini.GItinerary, verdicts: Verdicts, imported: dict[str, PlaceRow],
    legs: Legs | None = None,
) -> tuple[Itinerary, dict]:
    """Contract shape. Stops Gemini invented become places (origin='ai'), replacing earlier AI suggestions."""
    db.execute(delete(PlaceRow).where(PlaceRow.trip_id == trip.id, PlaceRow.origin == "ai"))
    categories: dict[str, str | None] = {}
    city_by_date = _city_by_date(trip)

    days = []
    for d, (gday, day_verdicts) in enumerate(zip(plan.days, verdicts)):
        items = []
        for j, (g, verdict) in enumerate(zip(gday.items, day_verdicts)):
            leg = legs[d][j] if legs else None
            place_id = g.placeId
            category = imported[place_id].category if place_id in imported else None
            if place_id in imported:
                saved = imported[place_id]
                if saved.lat is None and _valid_coords(g.placeLat, g.placeLng):
                    saved.lat, saved.lng = g.placeLat, g.placeLng  # imported without coords: Gemini placed it
            if g.newPlace is not None:
                np = g.newPlace
                place_id = new_id("p")
                db.add(PlaceRow(
                    id=place_id, trip_id=trip.id, name=np.name, name_english=np.nameEnglish,
                    category=np.category.lower() if np.category else None,
                    lat=np.lat if -90 <= np.lat <= 90 else None,
                    lng=np.lng if -180 <= np.lng <= 180 else None,
                    origin="ai",
                ))
                category = categories[place_id] = np.category.lower() if np.category else None
            items.append(ItineraryItem(
                time=g.time, place_id=place_id, duration_mins=g.durationMins, note=g.note,
                estimated_cost=g.estimatedCost, currency=g.currency,
                cost_home=0.0,  # filled in by budget.apply_budget
                status=final_status(g.status, verdict, category),
                travel_mins=leg.mins if leg else None,
                travel_mode=leg.mode if leg else None,
                travel_km=leg.km if leg else None,
            ))
        days.append(ItineraryDay(date=gday.date, city=city_by_date.get(gday.date), holiday=None, items=items,
                                 day_total_home=0.0))

    return Itinerary(days=days, trip_total_home=0.0, home_currency=trip.home_currency), categories


def apply_costs(db: Session, itinerary: Itinerary) -> Itinerary:
    """One rate per distinct item currency -> home currency, then the Decimal budget maths."""
    home = itinerary.home_currency
    rates = {}
    for currency in {i.currency for d in itinerary.days for i in d.items}:
        rate, source = fx.get_rate(db, currency, home)
        rates[currency] = rate
        log.info("fx %s->%s = %s (%s)", currency, home, rate, source)
    return budget.apply_budget(itinerary, rates)


def save(db: Session, trip_id: str, itinerary: Itinerary) -> None:
    # clock_timestamp(), not now(): now() is when the *transaction* began, which can be long before a
    # 30-60s generation finishes. The duplicate-request check in routers/itinerary.py relies on this.
    stmt = pg_insert(ItineraryRow).values(
        trip_id=trip_id, data=itinerary.model_dump(by_alias=True, mode="json"), updated_at=func.clock_timestamp(),
    )
    db.execute(stmt.on_conflict_do_update(
        index_elements=[ItineraryRow.trip_id],
        set_={"data": stmt.excluded.data, "updated_at": stmt.excluded.updated_at},
    ))


def _sort(plan: gemini.GItinerary) -> gemini.GItinerary:
    for day in plan.days:
        day.items.sort(key=lambda i: i.time)
    return plan


# If the first plan already took this long, skip the fix pass: a second Gemini call would push the
# request past ~90s. Closed stops then stay visible as "closed" rather than the user waiting.
FIX_PASS_BUDGET_S = 45.0
# Hard cap on Gemini time per request, across model fallbacks and retries (see gemini.deadline).
GENERATION_DEADLINE_S = 100.0


def build_itinerary(db: Session, trip: TripRow) -> Itinerary:
    with gemini.deadline(GENERATION_DEADLINE_S):
        return _build_itinerary(db, trip)


def _build_itinerary(db: Session, trip: TripRow) -> Itinerary:
    started = time.perf_counter()
    imported_rows = list(db.scalars(
        select(PlaceRow).where(PlaceRow.trip_id == trip.id, PlaceRow.origin == "import")
    ))
    imported = {p.id: p for p in imported_rows}
    holidays = trip_holidays(db, trip)

    plan = _sort(gemini.generate_plan(trip, imported_rows, holidays))
    legs, too_long = fit_travel(trip, plan, imported)  # before the hours check: it must see the real times
    verdicts, closed = check_hours(trip, plan, imported)
    missing = missing_saved_places(plan, imported)
    log.info("trip=%s saved places used: %d/%d", trip.id, len(imported) - len(missing), len(imported))
    # Only chase missing places if they could plausibly fit (~3 saved places a day); otherwise
    # Gemini is right to leave some out, and a second call would just add latency.
    if len(imported) > 3 * len(plan.days):
        missing = []

    problems = closed or missing or too_long
    elapsed = time.perf_counter() - started
    if problems and elapsed > FIX_PASS_BUDGET_S:
        log.warning("trip=%s skipping fix pass: first plan took %.0fs (budget %.0fs); %d closed, %d missing, %d too long",
                    trip.id, elapsed, FIX_PASS_BUDGET_S, len(closed), len(missing), len(too_long))
    elif problems:  # one fix pass; if it fails, keep the first plan and show those items as they are
        log.info("trip=%s fix pass: %d closed, %d missing, %d too long: %s", trip.id, len(closed), len(missing),
                 len(too_long), (closed + missing + too_long)[:3])
        try:
            plan = _sort(gemini.generate_plan(trip, imported_rows, holidays, previous=plan, closed=closed,
                                              missing=missing, timing=too_long))
            legs, too_long = fit_travel(trip, plan, imported)
            verdicts, closed = check_hours(trip, plan, imported)
            log.info("trip=%s after fix: %d closed, %d saved places still missing, %d days too long",
                     trip.id, len(closed), len(missing_saved_places(plan, imported)), len(too_long))
        except ApiError as e:
            log.warning("trip=%s fix pass failed (%s); keeping first plan", trip.id, e.code)

    itinerary, ai_categories = _to_itinerary(db, trip, plan, verdicts, imported, legs)
    categories = {pid: p.category for pid, p in imported.items()} | ai_categories
    apply_closure_check(itinerary, holidays, categories)
    apply_costs(db, itinerary)
    save(db, trip.id, itinerary)
    db.commit()
    log.info("trip=%s itinerary built in %.1fs", trip.id, time.perf_counter() - started)
    return itinerary
