"""Create or refresh the demo trip t_demo0001 and generate its itinerary, so the demo loads instantly.

Run from backend/:
    python seed_demo.py                # upsert trip + imported places, then generate the itinerary
    python seed_demo.py --no-generate  # upsert only (no Gemini call)

Safe right before a demo: nothing is deleted up front. The previous itinerary is only replaced
once a new one has been generated successfully, so a Gemini failure leaves the old one in place.
"""
import datetime as dt
import sys
import time

from sqlalchemy import delete

from app.db import _session_factory
from app.errors import ApiError
from app.mocks import DEMO_PLACES, DEMO_TRIP
from app.models import ItineraryRow, PlaceRow, TripRow
from app.services import planner

IMPORTED = [p for p in DEMO_PLACES if p.source_url]  # the ones "from TikTok"; Gemini adds the rest


def upsert_trip(db) -> TripRow:
    t = DEMO_TRIP
    row = db.get(TripRow, t.id) or TripRow(id=t.id)
    row.destination, row.country_code, row.local_currency = t.destination, "JP", "JPY"
    row.start_date, row.end_date = t.start_date, t.end_date
    row.day_start, row.day_end = dt.time.fromisoformat(t.day_start), dt.time.fromisoformat(t.day_end)
    row.travellers, row.interests, row.home_currency, row.route = t.travellers, t.interests, t.home_currency, []
    db.add(row)
    db.flush()

    # Reset the imported places to exactly the demo set (AI places are left for build_itinerary to replace).
    db.execute(delete(PlaceRow).where(PlaceRow.trip_id == t.id, PlaceRow.origin == "import"))
    for p in IMPORTED:
        db.add(PlaceRow(
            id=p.id, trip_id=t.id, name=p.name, name_english=p.name_english, category=p.category,
            lat=p.lat, lng=p.lng, confidence=p.confidence, source_url=p.source_url,
            ts=p.timestamp, tip=p.tip, origin="import",
        ))
    db.commit()
    return row


def main() -> int:
    generate = "--no-generate" not in sys.argv[1:]
    with _session_factory()() as db:
        trip = upsert_trip(db)
        print(f"Seeded {trip.id} ({trip.destination}, {trip.start_date} -> {trip.end_date}) "
              f"with {len(IMPORTED)} imported places")
        if not generate:
            return 0

        had_itinerary = db.get(ItineraryRow, trip.id) is not None
        t0 = time.perf_counter()
        try:
            it = planner.build_itinerary(db, trip)
        except ApiError as e:
            db.rollback()
            kept = "the previous itinerary is still in place" if had_itinerary else "there is NO itinerary yet"
            print(f"!! Generation failed ({e.code}: {e.message}); {kept}.", file=sys.stderr)
            return 1

        items = [i for d in it.days for i in d.items]
        statuses = {s: sum(i.status == s for i in items) for s in ("ok", "check_hours", "closed")}
        print(f"Generated in {time.perf_counter() - t0:.0f}s: {len(it.days)} days, {len(items)} stops, "
              f"{statuses}, total {it.trip_total_home:.2f} {it.home_currency} per person")
        for d in it.days:
            if d.holiday:
                print(f"  {d.date}: {d.holiday}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
