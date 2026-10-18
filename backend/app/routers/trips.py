import datetime as dt

from fastapi import APIRouter, Depends
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiError, not_found
from ..ids import new_id
from ..mocks import DEMO_TRIP_ID
from ..models import ItineraryRow, PlaceRow, TripRow
from ..ratelimit import write_limit
from ..schemas import Journey, RouteLeg, Stay, Trip, TripCreate, TripUpdate
from ..services.cities import canonical_city
from ..services.geo import currency_for, geocode, resolve_destination
from ..services.route import day_legs as route_days

router = APIRouter(prefix="/trips", tags=["trips"])

# Trips anyone can see but nobody can change (judges will open the demo; PATCH would wipe its itinerary).
READ_ONLY_TRIPS = {DEMO_TRIP_ID}

# Changing any of these makes the stored itinerary wrong, so PATCH deletes it (and the AI-suggested
# stops). The next GET /itinerary then says no_itinerary and the front end regenerates.
# `travellers` isn't here: costs are per person, so the plan stays valid.
REPLAN_FIELDS = {"destination", "route", "start_date", "end_date", "day_start", "day_end", "interests", "home_currency",
                 "stays", "transport"}


def trip_out(row: TripRow) -> Trip:
    return Trip(
        id=row.id,
        destination=row.destination,
        start_date=row.start_date,
        end_date=row.end_date,
        day_start=row.day_start.strftime("%H:%M"),
        day_end=row.day_end.strftime("%H:%M"),
        travellers=row.travellers,
        interests=list(row.interests),
        home_currency=row.home_currency,
        route=[RouteLeg(city=r["city"], country=r["country"], days=r["days"]) for r in row.route or []],
        stays=[Stay.model_validate(s) for s in row.stays or []],
        transport=[Journey.model_validate(t) for t in row.transport or []],
    )


def _stays_json(stays: list[Stay], trip: TripRow) -> list[dict]:
    """Stays as stored, with coordinates looked up (OpenStreetMap) for any the user didn't place.
    The search is limited to the country the traveller is in on the check-in date."""
    country_on = {d: leg.country for d, leg in route_days(trip)}
    out = []
    for s in stays:
        country = country_on.get(s.check_in) or trip.country_code
        if s.lat is None or s.lng is None:
            hit = geocode(", ".join(x for x in (s.name, s.address, s.city) if x), country)
            if hit is None and s.address:
                hit = geocode(", ".join(x for x in (s.address, s.city) if x), country)
            if hit is not None:
                s = s.model_copy(update={"lat": hit["lat"], "lng": hit["lng"]})
        out.append(s.model_dump(by_alias=True, mode="json"))
    return out


def _transport_json(transport: list[Journey]) -> list[dict]:
    return [t.model_dump(by_alias=True, mode="json") for t in sorted(transport, key=lambda t: t.departs)]


def current_stays(row: TripRow) -> list[Stay]:
    return [Stay.model_validate(s) for s in row.stays or []]


def get_trip_or_404(db: Session, trip_id: str) -> TripRow:
    row = db.get(TripRow, trip_id)
    if row is None:
        raise not_found("Trip", trip_id)
    return row


def real_route(legs: list[RouteLeg]) -> list[RouteLeg]:
    """Every city must be one the front end's dropdown offers; returns them in the list's spelling."""
    out = []
    for leg in legs:
        name = canonical_city(leg.country, leg.city)
        if name is None:
            raise ApiError(422, "unknown_city",
                           f"We couldn't find “{leg.city}” in {leg.country}. Please pick a city from the list.")
        out.append(leg.model_copy(update={"city": name}))
    return out


def _location(destination: str, route: list[RouteLeg]) -> tuple[str | None, str | None, list[dict]]:
    """(country_code, local_currency, route JSON). With a route, countries come from it (no Nominatim)."""
    if route:
        legs = [{**leg.model_dump(), "currency": currency_for(leg.country)} for leg in route]
        return legs[0]["country"], legs[0]["currency"], legs  # first leg, for older code
    return (*resolve_destination(destination), [])


@router.post("", response_model=Trip, status_code=201, dependencies=[Depends(write_limit)])
def create_trip(body: TripCreate, db: Session = Depends(get_db)) -> Trip:
    route = real_route(body.route)
    country_code, local_currency, route_json = _location(body.destination, route)
    row = TripRow(
        id=new_id("t"),
        destination=body.destination,
        country_code=country_code,
        local_currency=local_currency,
        start_date=body.start_date,
        end_date=body.end_date,
        day_start=dt.time.fromisoformat(body.day_start),
        day_end=dt.time.fromisoformat(body.day_end),
        travellers=body.travellers,
        interests=body.interests,
        home_currency=body.home_currency,
        route=route_json,
        transport=_transport_json(body.transport),
    )
    row.stays = _stays_json(body.stays, row)
    db.add(row)
    db.commit()
    return trip_out(row)


@router.get("/{trip_id}", response_model=Trip)
def get_trip(trip_id: str, db: Session = Depends(get_db)) -> Trip:
    return trip_out(get_trip_or_404(db, trip_id))


@router.patch("/{trip_id}", response_model=Trip, dependencies=[Depends(write_limit)])
def update_trip(trip_id: str, body: TripUpdate, db: Session = Depends(get_db)) -> Trip:
    """Change some fields of a trip, e.g. after the user edits the route on the itinerary page."""
    row = get_trip_or_404(db, trip_id)
    if row.id in READ_ONLY_TRIPS:
        raise ApiError(403, "read_only", "The demo trip can't be changed. Create your own trip to edit it.")

    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return trip_out(row)
    current = trip_out(row).model_dump(exclude={"id"})
    try:  # validate the merged trip exactly like a new one
        merged = TripCreate.model_validate({**current, **changes})
    except ValidationError as e:
        raise RequestValidationError(e.errors()) from None  # -> the usual 422 validation_error
    route = real_route(merged.route)

    if "route" in changes or "destination" in changes:
        row.country_code, row.local_currency, row.route = _location(merged.destination, route)
    row.destination = merged.destination
    row.start_date, row.end_date = merged.start_date, merged.end_date
    row.day_start, row.day_end = dt.time.fromisoformat(merged.day_start), dt.time.fromisoformat(merged.day_end)
    row.travellers, row.interests, row.home_currency = merged.travellers, merged.interests, merged.home_currency
    if "stays" in changes and merged.stays != current_stays(row):
        row.stays = _stays_json(merged.stays, row)
    if "transport" in changes:
        row.transport = _transport_json(merged.transport)

    after = trip_out(row).model_dump(exclude={"id"})
    if any(after[f] != current[f] for f in REPLAN_FIELDS):
        db.execute(delete(ItineraryRow).where(ItineraryRow.trip_id == row.id))
        db.execute(delete(PlaceRow).where(PlaceRow.trip_id == row.id, PlaceRow.origin == "ai"))
    db.commit()
    return trip_out(row)
