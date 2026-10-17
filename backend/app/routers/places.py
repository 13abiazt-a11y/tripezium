from fastapi import APIRouter

from .. import mocks
from ..ids import new_id
from ..schemas import Place, PlacesIn, PlacesOut
from .trips import get_trip_or_404

router = APIRouter(prefix="/trips/{trip_id}/places", tags=["places"])


@router.post("", response_model=PlacesOut)
def save_places(trip_id: str, body: PlacesIn) -> PlacesOut:
    get_trip_or_404(trip_id)
    store = mocks.PLACES.setdefault(trip_id, {})
    saved = []
    for p in body.places:
        place = Place(**{**p.model_dump(), "id": p.id or new_id("p")})
        store[place.id] = place  # upsert by id
        saved.append(place)
    return PlacesOut(places=saved)
