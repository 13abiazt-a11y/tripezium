"""The itinerary pipeline: holidays -> Gemini -> opening-hours check (+ one fix pass) -> closure check -> save.

Kept separate from the router so the Sunday chat-edit endpoint can reuse the same steps.
"""
import datetime as dt
import logging

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..ids import new_id
from ..models import ItineraryRow, PlaceRow, TripRow
from ..schemas import Itinerary, ItineraryDay, ItineraryItem
from . import budget, fx, gemini, hours
from .holidays import apply_closure_check, get_holidays

log = logging.getLogger("app.planner")

# Hours verdict per item: "open" | "closed" | "unknown" (no hours found), or None when the check is off.
Verdicts = list[list[str | None]]


def _stop(item: gemini.GItem, imported: dict[str, PlaceRow]) -> hours.Stop:
    if item.placeId is not None:
        p = imported[item.placeId]
        return hours.Stop(p.name, p.lat, p.lng)
    np = item.newPlace
    return hours.Stop(np.name, np.lat, np.lng)


def _name(item: gemini.GItem, imported: dict[str, PlaceRow]) -> str:
    if item.placeId is not None:
        p = imported[item.placeId]
        return p.name_english or p.name
    return item.newPlace.nameEnglish or item.newPlace.name


def check_hours(trip: TripRow, plan: gemini.GItinerary, imported: dict[str, PlaceRow]) -> tuple[Verdicts, list[str]]:
    """Check every item against opening hours. Returns verdicts and human-readable 'closed' lines for Gemini."""
    on = hours.enabled()
    found = hours.lookup_all({_stop(i, imported) for d in plan.days for i in d.items}, trip.destination) if on else {}

    verdicts: Verdicts = []
    closed: list[str] = []
    for day in plan.days:
        date = dt.date.fromisoformat(day.date)
        row = []
        for item in day.items:
            verdict = None
            if on:
                h = found.get(_stop(item, imported))
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
    db: Session, trip: TripRow, plan: gemini.GItinerary, verdicts: Verdicts, imported: dict[str, PlaceRow]
) -> tuple[Itinerary, dict]:
    """Contract shape. Stops Gemini invented become places (origin='ai'), replacing earlier AI suggestions."""
    db.execute(delete(PlaceRow).where(PlaceRow.trip_id == trip.id, PlaceRow.origin == "ai"))
    categories: dict[str, str | None] = {}

    days = []
    for gday, day_verdicts in zip(plan.days, verdicts):
        items = []
        for g, verdict in zip(gday.items, day_verdicts):
            place_id = g.placeId
            category = imported[place_id].category if place_id in imported else None
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
            ))
        days.append(ItineraryDay(date=gday.date, holiday=None, items=items, day_total_home=0.0))

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
    stmt = pg_insert(ItineraryRow).values(trip_id=trip_id, data=itinerary.model_dump(by_alias=True, mode="json"))
    db.execute(stmt.on_conflict_do_update(
        index_elements=[ItineraryRow.trip_id],
        set_={"data": stmt.excluded.data, "updated_at": stmt.excluded.updated_at},
    ))


def _sort(plan: gemini.GItinerary) -> gemini.GItinerary:
    for day in plan.days:
        day.items.sort(key=lambda i: i.time)
    return plan


def build_itinerary(db: Session, trip: TripRow) -> Itinerary:
    imported_rows = list(db.scalars(
        select(PlaceRow).where(PlaceRow.trip_id == trip.id, PlaceRow.origin == "import")
    ))
    imported = {p.id: p for p in imported_rows}
    holidays = get_holidays(db, trip.country_code, trip.start_date, trip.end_date)

    plan = _sort(gemini.generate_plan(trip, imported_rows, holidays))
    verdicts, closed = check_hours(trip, plan, imported)

    if closed:  # one fix pass; if it fails, keep the first plan and show those items as closed
        log.info("trip=%s %d closed stops, asking Gemini to fix: %s", trip.id, len(closed), closed[:3])
        try:
            plan = _sort(gemini.generate_plan(trip, imported_rows, holidays, previous=plan, closed=closed))
            verdicts, closed = check_hours(trip, plan, imported)
            log.info("trip=%s after fix: %d closed stops remain", trip.id, len(closed))
        except ApiError as e:
            log.warning("trip=%s closure fix failed (%s); keeping first plan", trip.id, e.code)

    itinerary, ai_categories = _to_itinerary(db, trip, plan, verdicts, imported)
    categories = {pid: p.category for pid, p in imported.items()} | ai_categories
    apply_closure_check(itinerary, holidays, categories)
    apply_costs(db, itinerary)
    save(db, trip.id, itinerary)
    db.commit()
    return itinerary
