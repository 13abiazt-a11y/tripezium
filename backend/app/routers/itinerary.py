from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import mocks
from ..db import get_db
from ..schemas import Itinerary
from .trips import get_trip_or_404

router = APIRouter(prefix="/trips/{trip_id}/itinerary", tags=["itinerary"])


@router.post("", response_model=Itinerary)
def generate_itinerary(trip_id: str, db: Session = Depends(get_db)) -> Itinerary:
    get_trip_or_404(db, trip_id)
    return mocks.demo_itinerary()  # still the Tokyo mock until M3 (Gemini)


@router.get("", response_model=Itinerary)
def get_itinerary(trip_id: str, db: Session = Depends(get_db)) -> Itinerary:
    get_trip_or_404(db, trip_id)
    return mocks.demo_itinerary()
