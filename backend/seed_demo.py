"""Create (or reset) the demo trip t_demo0001 and its places. Run from backend/: python seed_demo.py

M8 extends this to also generate and store the demo itinerary.
"""
import datetime as dt

from sqlalchemy import delete

from app.db import _session_factory
from app.mocks import DEMO_PLACES, DEMO_TRIP
from app.models import PlaceRow, TripRow


def main() -> None:
    t = DEMO_TRIP
    with _session_factory()() as db:
        db.execute(delete(TripRow).where(TripRow.id == t.id))  # cascades to places + itinerary
        db.add(TripRow(
            id=t.id, destination=t.destination, country_code="JP", local_currency="JPY",
            start_date=t.start_date, end_date=t.end_date,
            day_start=dt.time.fromisoformat(t.day_start), day_end=dt.time.fromisoformat(t.day_end),
            travellers=t.travellers, interests=t.interests, home_currency=t.home_currency,
        ))
        db.flush()
        for p in DEMO_PLACES:
            db.add(PlaceRow(
                id=p.id, trip_id=t.id, name=p.name, name_english=p.name_english, category=p.category,
                lat=p.lat, lng=p.lng, confidence=p.confidence, source_url=p.source_url,
                ts=p.timestamp, tip=p.tip, origin="import" if p.source_url else "ai",
            ))
        db.commit()
    print(f"Seeded {t.id} ({t.destination}) with {len(DEMO_PLACES)} places")


if __name__ == "__main__":
    main()
