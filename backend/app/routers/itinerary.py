from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiError
from ..models import ItineraryRow
from ..schemas import Itinerary
from ..services import planner
from .trips import get_trip_or_404

router = APIRouter(prefix="/trips/{trip_id}/itinerary", tags=["itinerary"])


@router.post("", response_model=Itinerary)
def generate_itinerary(trip_id: str, db: Session = Depends(get_db)) -> Itinerary:
    return planner.build_itinerary(db, get_trip_or_404(db, trip_id))


@router.get("", response_model=Itinerary)
def get_itinerary(trip_id: str, db: Session = Depends(get_db)) -> Itinerary:
    get_trip_or_404(db, trip_id)
    row = db.get(ItineraryRow, trip_id)
    if row is None:
        raise ApiError(404, "no_itinerary", f"No itinerary yet for trip '{trip_id}'. POST to generate one.")
    return Itinerary.model_validate(row.data)
