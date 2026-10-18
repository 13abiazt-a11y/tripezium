"""Checking days the user changed on the itinerary page (voice or typed edits).

The page's assistant rewrites whole days, with new places inline. This runs the same checks a
generated plan gets (travel time, opening hours, public holidays, costs), without asking Gemini
again, and saves the result into the stored itinerary so the change isn't stuck in one browser.
"""
import datetime as dt
import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..ids import new_id
from ..models import ItineraryRow, PlaceRow, TripRow
from ..schemas import EditDayIn, EditDayOut, EditItemOut, Itinerary, ItineraryItem, Money
from . import budget, fx, hours, planner, route, travel
from .geo import currency_for
from .holidays import CLOSURE_PRONE

log = logging.getLogger("app.edits")


def _day_info(trip: TripRow) -> dict[dt.date, route.Leg]:
    return dict(route.day_legs(trip))


def _currency(day: EditDayIn, leg: route.Leg | None, trip: TripRow) -> str:
    """The currency a new stop's estimate is in: the day's country (it may have moved city)."""
    if day.country and (leg is None or day.country != leg.country):
        c = currency_for(day.country)
        if c:
            return c
    return (leg.currency if leg else None) or trip.local_currency or trip.home_currency


def check_days(db: Session, trip: TripRow, days: list[EditDayIn]) -> list[EditDayOut]:
    legs = _day_info(trip)
    for d in days:
        if d.date not in legs:
            raise ApiError(422, "date_outside_trip", f"{d.date} isn't one of this trip's days.")
    holidays = {h.date: h.name for h in planner.trip_holidays(db, trip)}
    day_end = trip.day_end.hour * 60 + trip.day_end.minute

    # Travel first: it can push stops later, and the hours check must see the real times.
    timed = []
    for d in days:
        items = sorted(d.items, key=lambda i: i.time)
        stops = [travel.Stop(i.time, i.duration_mins, i.lat, i.lng) for i in items]
        times, day_legs, problem = planner.fit_one_day(trip, d.date, stops, day_end)
        timed.append((d, items, times, day_legs, problem))

    city_of = {d.date: d.city or legs[d.date].city for d in days}
    on = hours.enabled()
    found = hours.lookup_all(
        {hours.Stop(i.name, i.lat, i.lng, city_of[d.date]) for d, items, *_ in timed for i in items},
        trip.destination,
    ) if on else {}

    rates: dict[str, Decimal | None] = {}

    def rate(currency: str) -> Decimal | None:
        if currency not in rates:
            rates[currency] = fx.get_rate(db, currency, trip.home_currency)[0]
        return rates[currency]

    out = []
    for d, items, times, day_legs, problem in timed:
        leg = legs[d.date]
        holiday = holidays.get(d.date) if (d.country or leg.country) == leg.country else None
        local = _currency(d, leg, trip)
        problems: list[str] = []
        total = Decimal(0)
        priced = True
        checked = []
        for item, t, tl in zip(items, times, day_legs):
            verdict = None
            if on:
                h = found.get(hours.Stop(item.name, item.lat, item.lng, city_of[d.date]))
                if h is None:
                    verdict = "unknown"
                elif hours.is_open_for_visit(h, d.date, t, item.duration_mins):
                    verdict = "open"
                else:
                    verdict = "closed"
                    problems.append(f"{item.name} isn't open at {t} ({hours.describe_day(h, d.date)}).")
            status = planner.final_status(item.status or "ok", verdict, item.category)
            if holiday and status == "ok" and (item.category or "").lower() in CLOSURE_PRONE:
                status = "check_hours"

            local_cost = item.local_cost
            if local_cost is None and item.estimated_cost is not None:
                local_cost = Money(amount=item.estimated_cost, currency=local)
            cost = None
            if local_cost is not None and (r := rate(local_cost.currency)) is not None:
                c = budget.cost_home(local_cost.amount, r)
                cost = Money(amount=float(c), currency=trip.home_currency)
                total += c
            else:
                priced = False

            if t != item.time:
                problems.append(f"{item.name} moved to {t} to leave time to get there.")
            checked.append(EditItemOut(
                **item.model_dump(exclude={"time", "status", "local_cost"}),
                time=t, status=status, local_cost=local_cost, cost=cost,
                travel_mins=tl.mins if tl else None, travel_mode=tl.mode if tl else None,
                travel_km=tl.km if tl else None,
            ))
        if problem:
            problems.append(problem[0].upper() + problem[1:] + ".")
        out.append(EditDayOut(
            date=d.date, city=d.city or leg.city, country=d.country or leg.country, holiday=holiday,
            items=checked, problems=problems,
            total=Money(amount=float(total), currency=trip.home_currency) if priced else None,
        ))
    return out


def _norm(s: str | None) -> str:
    return " ".join((s or "").lower().split())


def save_days(db: Session, trip: TripRow, days: list[EditDayOut]) -> bool:
    """Put the checked days into the stored itinerary. New places become places (origin 'ai', like
    Gemini's own suggestions: a regenerated plan replaces them). False if there's no stored plan."""
    row = db.get(ItineraryRow, trip.id)
    if row is None:
        return False
    itinerary = Itinerary.model_validate(row.data)
    places = list(db.scalars(select(PlaceRow).where(PlaceRow.trip_id == trip.id)))
    by_name: dict[str, PlaceRow] = {}
    for p in places:
        for n in (p.name_english, p.name):
            if n:
                by_name.setdefault(_norm(n), p)

    by_date = {d.date: d for d in itinerary.days}
    for d in days:
        items = []
        for i in d.items:
            place = by_name.get(_norm(i.name)) or by_name.get(_norm(i.local_name))
            if place is None:
                place = PlaceRow(
                    id=new_id("p"), trip_id=trip.id, name=i.local_name or i.name, name_english=i.name,
                    category=(i.category or "").lower() or None, lat=i.lat, lng=i.lng, tip=i.tip, origin="ai",
                )
                db.add(place)
                by_name[_norm(i.name)] = place
            elif place.lat is None and i.lat is not None:
                place.lat, place.lng = i.lat, i.lng
            items.append(ItineraryItem(
                time=i.time, place_id=place.id, duration_mins=i.duration_mins, note=i.note or "",
                estimated_cost=i.local_cost.amount if i.local_cost else 0.0,
                currency=i.local_cost.currency if i.local_cost else trip.home_currency,
                cost_home=0.0, status=i.status,
                travel_mins=i.travel_mins, travel_mode=i.travel_mode, travel_km=i.travel_km,
            ))
        day = by_date.get(d.date)
        if day is None:
            continue
        day.items = items
        if d.city:
            day.city = d.city  # the assistant may have moved the day to another city

    planner.apply_costs(db, itinerary)
    planner.save(db, trip.id, itinerary)
    db.commit()
    log.info("trip=%s saved %d edited day(s)", trip.id, len(days))
    return True
