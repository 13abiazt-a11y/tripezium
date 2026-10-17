from fastapi import APIRouter

from .. import mocks
from ..schemas import Itinerary
from .trips import get_trip_or_404

router = APIRouter(prefix="/trips/{trip_id}/itinerary", tags=["itinerary"])


@router.post("", response_model=Itinerary)
def generate_itinerary(trip_id: str) -> Itinerary:
    get_trip_or_404(trip_id)
    return mocks.demo_itinerary()  # M1: same Tokyo mock for every trip


@router.get("", response_model=Itinerary)
def get_itinerary(trip_id: str) -> Itinerary:
    get_trip_or_404(trip_id)
    return mocks.demo_itinerary()
