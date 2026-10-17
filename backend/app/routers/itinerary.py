import threading
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiError
from ..models import ItineraryRow
from ..ratelimit import generate_limit
from ..schemas import Itinerary
from ..services import planner
from .trips import get_trip_or_404

router = APIRouter(prefix="/trips/{trip_id}/itinerary", tags=["itinerary"])

# One generation per trip at a time. If the page is reopened (or a judge clicks back and forth)
# while a plan is being made, the second request waits for the first and returns its result,
# instead of paying Gemini for a second plan that would overwrite the first. In-memory is enough:
# the server runs one process (deploy/iku-api.service).
_guard = threading.Lock()
_trip_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)


def _lock_for(trip_id: str) -> threading.Lock:
    with _guard:
        return _trip_locks[trip_id]


@router.post("", response_model=Itinerary, dependencies=[Depends(generate_limit)])
def generate_itinerary(trip_id: str, db: Session = Depends(get_db)) -> Itinerary:
    trip = get_trip_or_404(db, trip_id)
    asked_at = db.scalar(select(func.clock_timestamp()))  # the DB's clock: same one that stamps updated_at
    with _lock_for(trip_id):
        db.expire_all()
        row = db.get(ItineraryRow, trip_id)
        if row is not None and row.updated_at >= asked_at:
            return Itinerary.model_validate(row.data)  # made while we waited: reuse it
        return planner.build_itinerary(db, trip)


@router.get("", response_model=Itinerary)
def get_itinerary(trip_id: str, db: Session = Depends(get_db)) -> Itinerary:
    get_trip_or_404(db, trip_id)
    row = db.get(ItineraryRow, trip_id)
    if row is None:
        raise ApiError(404, "no_itinerary", f"No itinerary yet for trip '{trip_id}'. POST to generate one.")
    return Itinerary.model_validate(row.data)
