from fastapi import APIRouter

from .. import mocks
from ..errors import not_found
from ..ids import new_id
from ..schemas import Trip, TripCreate

router = APIRouter(prefix="/trips", tags=["trips"])


def get_trip_or_404(trip_id: str) -> Trip:
    trip = mocks.TRIPS.get(trip_id)
    if trip is None:
        raise not_found("Trip", trip_id)
    return trip


@router.post("", response_model=Trip, status_code=201)
def create_trip(body: TripCreate) -> Trip:
    trip = Trip(id=new_id("t"), **body.model_dump())
    mocks.TRIPS[trip.id] = trip
    mocks.PLACES[trip.id] = {}
    return trip


@router.get("/{trip_id}", response_model=Trip)
def get_trip(trip_id: str) -> Trip:
    return get_trip_or_404(trip_id)
