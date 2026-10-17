from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiError
from ..ids import new_id
from ..models import ItineraryRow, PlaceRow, TripRow
from ..schemas import Itinerary, ItineraryDay, ItineraryItem
from ..services import gemini
from .trips import get_trip_or_404

router = APIRouter(prefix="/trips/{trip_id}/itinerary", tags=["itinerary"])


def _to_itinerary(db: Session, trip: TripRow, plan: gemini.GItinerary) -> Itinerary:
    """Turn Gemini's plan into the contract shape. Stops Gemini invented become places (origin='ai')."""
    # Regenerating replaces the previous AI suggestions; imported places are never touched.
    db.execute(delete(PlaceRow).where(PlaceRow.trip_id == trip.id, PlaceRow.origin == "ai"))

    days = []
    for gday in plan.days:
        items = []
        for g in sorted(gday.items, key=lambda i: i.time):
            place_id = g.placeId
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
            items.append(ItineraryItem(
                time=g.time, place_id=place_id, duration_mins=g.durationMins, note=g.note,
                estimated_cost=g.estimatedCost, currency=g.currency,
                cost_home=0.0,  # M5: converted by budget.py
                status=g.status,
            ))
        days.append(ItineraryDay(date=gday.date, holiday=None, items=items, day_total_home=0.0))

    return Itinerary(days=days, trip_total_home=0.0, home_currency=trip.home_currency)


def _save(db: Session, trip_id: str, itinerary: Itinerary) -> None:
    data = itinerary.model_dump(by_alias=True, mode="json")
    stmt = pg_insert(ItineraryRow).values(trip_id=trip_id, data=data)
    db.execute(stmt.on_conflict_do_update(
        index_elements=[ItineraryRow.trip_id],
        set_={"data": stmt.excluded.data, "updated_at": stmt.excluded.updated_at},
    ))


@router.post("", response_model=Itinerary)
def generate_itinerary(trip_id: str, db: Session = Depends(get_db)) -> Itinerary:
    trip = get_trip_or_404(db, trip_id)
    imported = list(db.scalars(
        select(PlaceRow).where(PlaceRow.trip_id == trip_id, PlaceRow.origin == "import")
    ))
    plan = gemini.generate_plan(trip, imported)  # slow part; no DB writes yet
    itinerary = _to_itinerary(db, trip, plan)
    _save(db, trip_id, itinerary)
    db.commit()
    return itinerary


@router.get("", response_model=Itinerary)
def get_itinerary(trip_id: str, db: Session = Depends(get_db)) -> Itinerary:
    get_trip_or_404(db, trip_id)
    row = db.get(ItineraryRow, trip_id)
    if row is None:
        raise ApiError(404, "no_itinerary", f"No itinerary yet for trip '{trip_id}'. POST to generate one.")
    return Itinerary.model_validate(row.data)
