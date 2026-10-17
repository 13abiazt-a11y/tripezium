import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import not_found
from ..ids import new_id
from ..models import TripRow
from ..ratelimit import write_limit
from ..schemas import RouteLeg, Trip, TripCreate
from ..services.geo import currency_for, resolve_destination

router = APIRouter(prefix="/trips", tags=["trips"])


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
    )


def get_trip_or_404(db: Session, trip_id: str) -> TripRow:
    row = db.get(TripRow, trip_id)
    if row is None:
        raise not_found("Trip", trip_id)
    return row


@router.post("", response_model=Trip, status_code=201, dependencies=[Depends(write_limit)])
def create_trip(body: TripCreate, db: Session = Depends(get_db)) -> Trip:
    if body.route:
        # Countries come from the route, so no Nominatim lookup; each leg gets its own currency.
        route = [{**leg.model_dump(), "currency": currency_for(leg.country)} for leg in body.route]
        country_code, local_currency = route[0]["country"], route[0]["currency"]  # first leg, for older code
    else:
        route = []
        country_code, local_currency = resolve_destination(body.destination)
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
        route=route,
    )
    db.add(row)
    db.commit()
    return trip_out(row)


@router.get("/{trip_id}", response_model=Trip)
def get_trip(trip_id: str, db: Session = Depends(get_db)) -> Trip:
    return trip_out(get_trip_or_404(db, trip_id))
