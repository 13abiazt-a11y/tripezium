"""API tests against the real database. Skipped if DATABASE_URL isn't usable.

Every trip created here has a destination starting "pytest-" and is deleted afterwards.
Geocoding is faked so the tests never call Nominatim.
"""
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.config import get_settings
from app.db import _session_factory, check_db
from app.main import app
from app.mocks import demo_itinerary
from app.models import PlaceRow, TripRow
from app.routers import trips as trips_router
from app.schemas import Itinerary
from app.services import hours, planner
from app.services.gemini import GDay, GItem, GItinerary, GNewPlace
from app.services.holidays import Holiday

_url = get_settings().database_url
DB_READY = bool(_url) and "<password>" not in _url and check_db() == "ok"
needs_db = pytest.mark.skipif(not DB_READY, reason="DATABASE_URL not set or unreachable")

TRIP_BODY = {
    "destination": "pytest-Tokyo", "startDate": "2026-12-01", "endDate": "2026-12-04",
    "dayStart": "09:00", "dayEnd": "21:00", "travellers": 2,
    "interests": ["food", "temples", "nightlife"], "homeCurrency": "GBP",
}


@pytest.fixture
def client(monkeypatch):
    # No network in tests: fake geocoding, no holidays, hours check off (individual tests override).
    monkeypatch.setattr(trips_router, "resolve_destination", lambda d: ("JP", "JPY"))
    monkeypatch.setattr(planner, "get_holidays", lambda db, c, s, e: [])
    monkeypatch.setattr(hours, "enabled", lambda: False)
    monkeypatch.setattr(planner.fx, "get_rate", lambda db, b, q: (Decimal("0.005"), "test"))
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True, scope="module")
def _cleanup():
    yield
    if DB_READY:
        with _session_factory()() as db:
            db.execute(delete(TripRow).where(TripRow.destination.like("pytest-%")))
            db.commit()


@needs_db
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "db": "ok"}


@needs_db
def test_create_and_get_trip_persisted(client):
    r = client.post("/trips", json=TRIP_BODY)
    assert r.status_code == 201
    created = r.json()
    assert created["id"].startswith("t_")
    assert {k: created[k] for k in TRIP_BODY} == TRIP_BODY
    assert "countryCode" not in created  # internal only

    r = client.get(f"/trips/{created['id']}")
    assert r.status_code == 200
    assert r.json() == created

    with _session_factory()() as db:
        row = db.get(TripRow, created["id"])
        assert (row.country_code, row.local_currency) == ("JP", "JPY")


@needs_db
def test_validation_error_format(client):
    r = client.post("/trips", json={**TRIP_BODY, "endDate": "2026-11-01"})
    assert r.status_code == 422
    assert r.json()["error"] == "validation_error"
    assert "endDate" in r.json()["message"]


@needs_db
def test_not_found_format(client):
    r = client.get("/trips/t_nope")
    assert r.status_code == 404
    assert r.json() == {"error": "not_found", "message": "Trip 't_nope' not found"}


def test_unknown_route_uses_error_format():
    r = TestClient(app).get("/nope")
    assert r.status_code == 404
    assert set(r.json()) == {"error", "message"}


@needs_db
def test_save_places_upserts(client):
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    url = f"/trips/{trip_id}/places"

    r = client.post(url, json={"places": [
        {"name": "Senso-ji", "nameEnglish": "Senso-ji", "category": "temple",
         "lat": 35.7148, "lng": 139.7967, "confidence": 0.9,
         "sourceUrl": "https://youtube.com/x", "timestamp": "02:14", "tip": "Go early"},
        {"name": "Somewhere with no coords"},
    ]})
    assert r.status_code == 200
    first, second = r.json()["places"]
    assert first["id"].startswith("p_") and first["timestamp"] == "02:14"
    assert second["lat"] is None

    # Same ID again -> updated in place, not duplicated
    r = client.post(url, json={"places": [{**first, "tip": "Go at 7am"}]})
    assert r.json()["places"][0] == {**first, "tip": "Go at 7am"}


@needs_db
def test_place_id_from_another_trip_gets_new_id(client):
    a = client.post("/trips", json=TRIP_BODY).json()["id"]
    b = client.post("/trips", json=TRIP_BODY).json()["id"]
    pa = client.post(f"/trips/{a}/places", json={"places": [{"name": "x"}]}).json()["places"][0]
    pb = client.post(f"/trips/{b}/places", json={"places": [{"id": pa["id"], "name": "y"}]}).json()["places"][0]
    assert pb["id"] != pa["id"]


@needs_db
def test_place_bad_lat_rejected(client):
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    r = client.post(f"/trips/{trip_id}/places", json={"places": [{"name": "x", "lat": 120}]})
    assert r.status_code == 422


def _fake_plan(imported_id: str) -> GItinerary:
    def it(time, **kw):
        return GItem(time=time, durationMins=60, note="n", estimatedCost=1000, currency="JPY", status="ok",
                     **{"placeId": None, "newPlace": None, "placeLat": None, "placeLng": None, **kw})
    new = GNewPlace(name="築地", nameEnglish="Tsukiji", category="Market", lat=35.66, lng=139.77)
    dates = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]
    return GItinerary(days=[
        # out of order on purpose: the API sorts by time
        GDay(date=dates[0], items=[it("12:00", newPlace=new), it("09:00", placeId=imported_id)]),
        *[GDay(date=d, items=[it("10:00", newPlace=new)]) for d in dates[1:]],
    ])


@needs_db
def test_generate_itinerary_stores_and_creates_ai_places(client, monkeypatch):
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    imported = client.post(f"/trips/{trip_id}/places", json={"places": [{"name": "Senso-ji"}]}).json()["places"][0]

    seen = {}
    def fake_generate(trip, places, holidays=(), previous=None, closed=None, missing=None, timing=None):
        seen["places"] = [p.id for p in places]
        return _fake_plan(imported["id"])
    monkeypatch.setattr(planner.gemini, "generate_plan", fake_generate)

    assert client.get(f"/trips/{trip_id}/itinerary").json()["error"] == "no_itinerary"

    r = client.post(f"/trips/{trip_id}/itinerary")
    assert r.status_code == 200
    data = r.json()
    Itinerary.model_validate(data)
    assert seen["places"] == [imported["id"]]  # imported places are passed to Gemini
    day1 = data["days"][0]["items"]
    assert [i["time"] for i in day1] == ["09:00", "12:00"]
    assert [i["costHome"] for i in day1] == [5.0, 5.0]           # 1000 JPY * 0.005
    assert data["days"][0]["dayTotalHome"] == 10.0
    assert data["tripTotalHome"] == 25.0                          # 5 items * 5.00
    assert day1[0]["placeId"] == imported["id"]

    with _session_factory()() as db:
        ai = db.scalars(select(PlaceRow).where(PlaceRow.trip_id == trip_id, PlaceRow.origin == "ai")).all()
        assert len(ai) == 4 and ai[0].category == "market"
        assert day1[1]["placeId"] in {p.id for p in ai}

    # stored: GET returns the same thing
    assert client.get(f"/trips/{trip_id}/itinerary").json() == data

    # regenerating replaces old AI places instead of piling them up
    client.post(f"/trips/{trip_id}/itinerary")
    with _session_factory()() as db:
        assert len(db.scalars(select(PlaceRow).where(PlaceRow.trip_id == trip_id, PlaceRow.origin == "ai")).all()) == 4
        assert db.get(PlaceRow, imported["id"]) is not None


def test_mock_itinerary_totals_add_up():
    data = demo_itinerary().model_dump(by_alias=True, mode="json")
    day_sum = Decimal(0)
    for day in data["days"]:
        assert sum(Decimal(str(i["costHome"])) for i in day["items"]) == Decimal(str(day["dayTotalHome"]))
        day_sum += Decimal(str(day["dayTotalHome"]))
    assert day_sum == Decimal(str(data["tripTotalHome"]))
    assert next(d for d in data["days"] if d["date"] == "2027-01-01")["holiday"] == "New Year's Day"
    assert {i["status"] for d in data["days"] for i in d["items"]} == {"ok", "check_hours", "closed"}


@needs_db
def test_closed_stop_triggers_one_fix_pass_then_holiday_check(client, monkeypatch):
    """Day 1's imported place is closed per opening hours -> Gemini is asked once to fix it.
    The fix moves it to 12:00 (open). Day 2 is a fake holiday: a market there becomes check_hours."""
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    imported = client.post(f"/trips/{trip_id}/places", json={"places": [
        {"name": "Museum", "category": "museum", "lat": 35.0, "lng": 139.0}]}).json()["places"][0]
    museum_hours = hours.parse_hours({"periods": [
        {"open": {"day": d, "hour": 11, "minute": 0}, "close": {"day": d, "hour": 17, "minute": 0}} for d in range(7)
    ], "weekdayDescriptions": ["11:00 AM - 5:00 PM"] * 7})

    monkeypatch.setattr(hours, "enabled", lambda: True)
    monkeypatch.setattr(hours, "lookup_all", lambda stops, dest: {
        s: (museum_hours if s.name == "Museum" else None) for s in stops})
    monkeypatch.setattr(planner, "get_holidays", lambda db, c, s, e: [Holiday(gemini_date(1), "Test Holiday")])

    def it(time, **kw):
        return GItem(time=time, durationMins=60, note="", estimatedCost=0, currency="JPY", status="ok",
                     **{"placeId": None, "newPlace": None, "placeLat": None, "placeLng": None, **kw})
    market = GNewPlace(name="Market", nameEnglish="Market", category="market", lat=35.1, lng=139.1)
    def plan_with_museum_at(time):
        return GItinerary(days=[
            GDay(date="2026-12-01", items=[it(time, placeId=imported["id"])]),
            GDay(date="2026-12-02", items=[it("10:00", newPlace=market)]),
            GDay(date="2026-12-03", items=[it("10:00", newPlace=market)]),
            GDay(date="2026-12-04", items=[it("10:00", newPlace=market)]),
        ])

    calls = []
    def fake_generate(trip, places, holidays=(), previous=None, closed=None, missing=None, timing=None):
        calls.append(closed)
        return plan_with_museum_at("09:00" if previous is None else "12:00")
    monkeypatch.setattr(planner.gemini, "generate_plan", fake_generate)

    data = client.post(f"/trips/{trip_id}/itinerary").json()
    assert len(calls) == 2 and calls[0] is None
    assert "Museum" in calls[1][0] and "11:00 AM - 5:00 PM" in calls[1][0]   # Gemini told what's closed and why
    museum_item = data["days"][0]["items"][0]
    assert (museum_item["time"], museum_item["status"]) == ("12:00", "ok")   # fixed and verified open
    assert data["days"][1]["holiday"] == "Test Holiday"
    assert data["days"][1]["items"][0]["status"] == "check_hours"             # no hours found + holiday
    assert data["days"][0]["holiday"] is None


def gemini_date(i):
    import datetime as dt
    return dt.date(2026, 12, 1) + dt.timedelta(days=i)


@needs_db
def test_missing_saved_place_is_added_and_gets_coordinates(client, monkeypatch):
    """Gemini leaves out one of two saved places -> one fix pass asks for it. A saved place that came
    without coordinates gets Gemini's approximate ones, so it can go on the map."""
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    a, b = client.post(f"/trips/{trip_id}/places", json={"places": [
        {"name": "Senso-ji", "category": "temple"},                       # no coordinates
        {"name": "Golden Gai", "category": "nightlife", "lat": 35.694, "lng": 139.705},
    ]}).json()["places"]

    def it(time, **kw):
        return GItem(time=time, durationMins=60, note="", estimatedCost=0, currency="JPY", status="ok",
                     **{"placeId": None, "newPlace": None, "placeLat": None, "placeLng": None, **kw})
    filler = GNewPlace(name="Park", nameEnglish="Park", category="park", lat=35.0, lng=139.0)
    def make_plan(include_b):
        first = [it("09:00", placeId=a["id"], placeLat=35.7148, placeLng=139.7967)]
        if include_b:
            first.append(it("19:00", placeId=b["id"]))
        rest = [GDay(date=d, items=[it("10:00", newPlace=filler)]) for d in ["2026-12-02", "2026-12-03", "2026-12-04"]]
        return GItinerary(days=[GDay(date="2026-12-01", items=first), *rest])

    calls = []
    def fake_generate(trip, places, holidays=(), previous=None, closed=None, missing=None, timing=None):
        calls.append(missing)
        return make_plan(include_b=previous is not None)
    monkeypatch.setattr(planner.gemini, "generate_plan", fake_generate)

    data = client.post(f"/trips/{trip_id}/itinerary").json()
    assert calls[0] is None and calls[1] == [f"Golden Gai (placeId {b['id']})"]
    used = [i["placeId"] for i in data["days"][0]["items"]]
    assert used == [a["id"], b["id"]]                     # both saved places, with their own IDs

    with _session_factory()() as db:
        senso = db.get(PlaceRow, a["id"])
        assert (senso.lat, senso.lng) == (35.7148, 139.7967)
        assert senso.origin == "import"


@needs_db
def test_all_saved_places_used_means_no_extra_call(client, monkeypatch):
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    imported = client.post(f"/trips/{trip_id}/places", json={"places": [{"name": "Senso-ji"}]}).json()["places"][0]
    calls = []
    def fake_generate(trip, places, holidays=(), previous=None, closed=None, missing=None, timing=None):
        calls.append(1)
        return _fake_plan(imported["id"])
    monkeypatch.setattr(planner.gemini, "generate_plan", fake_generate)
    assert client.post(f"/trips/{trip_id}/itinerary").status_code == 200
    assert len(calls) == 1


@needs_db
def test_get_places_resolves_every_itinerary_place_id(client, monkeypatch):
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    assert client.get(f"/trips/{trip_id}/places").json() == {"places": []}

    imported = client.post(f"/trips/{trip_id}/places", json={"places": [
        {"name": "Senso-ji", "sourceUrl": "https://tiktok.com/x", "timestamp": "00:12"}]}).json()["places"][0]
    monkeypatch.setattr(planner.gemini, "generate_plan",
                        lambda trip, places, holidays=(), previous=None, closed=None, missing=None, timing=None: _fake_plan(imported["id"]))
    itinerary = client.post(f"/trips/{trip_id}/itinerary").json()

    r = client.get(f"/trips/{trip_id}/places")
    assert r.status_code == 200
    places = r.json()["places"]
    assert places[0] == imported                          # imported first, unchanged, camelCase
    by_id = {p["id"]: p for p in places}
    for day in itinerary["days"]:
        for item in day["items"]:
            assert item["placeId"] in by_id               # front end can resolve every stop
    ai = [p for p in places if p["id"] != imported["id"]]
    assert ai and all(p["lat"] is not None and p["sourceUrl"] is None for p in ai)


@needs_db
def test_get_places_unknown_trip_404(client):
    r = client.get("/trips/t_nope/places")
    assert r.status_code == 404 and r.json()["error"] == "not_found"


# --- travel time between stops -------------------------------------------------------

def _plan_with(days_items):
    def it(time, mins, name, lat, lng):
        return GItem(time=time, durationMins=mins, note="", estimatedCost=0, currency="JPY", status="ok",
                     placeId=None, placeLat=None, placeLng=None,
                     newPlace=GNewPlace(name=name, nameEnglish=name, category="landmark", lat=lat, lng=lng))
    dates = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]
    return GItinerary(days=[GDay(date=d, items=[it(*x) for x in items]) for d, items in zip(dates, days_items)])


ASAKUSA, NAKAMISE, SHIBUYA = (35.7148, 139.7967), (35.7119, 139.7964), (35.6595, 139.7005)
QUIET_DAY = [("10:00", 60, "Park", *SHIBUYA)]


@needs_db
def test_back_to_back_stops_across_town_are_pushed_later(client, monkeypatch):
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    plan = _plan_with([[("09:00", 60, "Senso-ji", *ASAKUSA), ("10:00", 60, "Nakamise", *NAKAMISE),
                        ("11:00", 60, "Shibuya", *SHIBUYA)], QUIET_DAY, QUIET_DAY, QUIET_DAY])
    calls = []
    monkeypatch.setattr(planner.gemini, "generate_plan", lambda *a, **k: calls.append(k) or plan.model_copy(deep=True))
    day1 = client.post(f"/trips/{trip_id}/itinerary").json()["days"][0]["items"]

    assert len(calls) == 1                                       # it fits the day: no fix pass needed
    first, walk, metro = day1
    assert first["travelMins"] is None                           # start of the day
    assert walk["travelMode"] == "walk" and walk["time"] == "10:10"   # 09:00-10:00 then a ~10 min walk
    assert metro["travelMode"] == "transit" and metro["travelKm"] > 5
    assert metro["time"] > "11:00"                               # pushed back to leave time for the metro


@needs_db
def test_day_that_overruns_with_travel_triggers_one_fix_pass(client, monkeypatch):
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]   # day ends 21:00
    overfull = _plan_with([[("09:00", 60, "Senso-ji", *ASAKUSA), ("19:30", 60, "Shibuya", *SHIBUYA),
                            ("20:30", 30, "Asakusa again", *ASAKUSA)], QUIET_DAY, QUIET_DAY, QUIET_DAY])
    fixed = _plan_with([[("09:00", 60, "Senso-ji", *ASAKUSA), ("19:30", 60, "Shibuya", *SHIBUYA)],
                        QUIET_DAY, QUIET_DAY, QUIET_DAY])
    calls = []
    def fake(*a, **k):
        calls.append(k)
        return (fixed if k.get("previous") is not None else overfull).model_copy(deep=True)
    monkeypatch.setattr(planner.gemini, "generate_plan", fake)

    day1 = client.post(f"/trips/{trip_id}/itinerary").json()["days"][0]["items"]
    assert len(calls) == 2
    assert calls[1]["timing"] and "2026-12-01" in calls[1]["timing"][0] and "past 21:00" in calls[1]["timing"][0]
    assert [i["time"] for i in day1][-1] <= "20:00"              # the fixed plan fits the day


# --- Checking edited days (POST /trips/{id}/itinerary/check) ----------------------------

def _generated_trip(client, monkeypatch):
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    plan = _plan_with([[("09:00", 60, "Senso-ji", *ASAKUSA)], QUIET_DAY, QUIET_DAY, QUIET_DAY])
    monkeypatch.setattr(planner.gemini, "generate_plan", lambda *a, **k: plan.model_copy(deep=True))
    client.post(f"/trips/{trip_id}/itinerary")
    return trip_id


def _edit(time, name, lat, lng, mins=60, **kw):
    return {"time": time, "name": name, "category": "museum", "durationMins": mins, "lat": lat, "lng": lng, **kw}


@needs_db
def test_edited_day_is_checked_and_saved(client, monkeypatch):
    trip_id = _generated_trip(client, monkeypatch)
    monkeypatch.setattr(hours, "enabled", lambda: True)
    shut = hours.Hours([(d * 1440 + 13 * 60, d * 1440 + 17 * 60) for d in range(7)], ["Monday: 13:00-17:00"] * 7)
    monkeypatch.setattr(hours, "lookup_all", lambda stops, dest: {s: shut if s.name == "Museum" else None for s in stops})

    body = {"days": [{"date": "2026-12-01", "items": [
        _edit("09:00", "Senso-ji", *ASAKUSA, localCost={"amount": 0, "currency": "JPY"}, category="landmark"),
        _edit("10:00", "Museum", *SHIBUYA, estimatedCost=2000),  # straight across town, and shut in the morning
    ]}]}
    r = client.post(f"/trips/{trip_id}/itinerary/check", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["saved"] is True
    day = out["days"][0]
    temple, museum = day["items"]
    assert museum["time"] > "10:00" and museum["travelMode"] == "transit"   # pushed later for the metro
    assert museum["status"] == "closed"                                      # opens at 13:00
    assert museum["localCost"] == {"amount": 2000.0, "currency": "JPY"}      # estimate in the day's currency
    assert museum["cost"] == {"amount": 10.0, "currency": "GBP"}             # 2000 JPY * 0.005
    assert day["total"] == {"amount": 10.0, "currency": "GBP"}
    assert temple["status"] == "ok"                                          # open air, no hours: fine
    assert any("isn't open" in p for p in day["problems"]) and any("moved to" in p for p in day["problems"])

    # saved into the stored plan: the new stop is a place, the old one is reused, totals updated
    it = client.get(f"/trips/{trip_id}/itinerary").json()
    stops = it["days"][0]["items"]
    assert [s["status"] for s in stops] == ["ok", "closed"]
    names = {p["id"]: p["nameEnglish"] for p in client.get(f"/trips/{trip_id}/places").json()["places"]}
    assert [names[s["placeId"]] for s in stops] == ["Senso-ji", "Museum"]
    assert it["days"][0]["dayTotalHome"] == 10.0
    assert len([n for n in names.values() if n == "Senso-ji"]) == 1


@needs_db
def test_edit_check_rejects_dates_outside_the_trip(client, monkeypatch):
    trip_id = _generated_trip(client, monkeypatch)
    r = client.post(f"/trips/{trip_id}/itinerary/check", json={"days": [{"date": "2027-01-01", "items": []}]})
    assert r.status_code == 422 and r.json()["error"] == "date_outside_trip"


@needs_db
def test_demo_trip_edits_are_checked_not_saved(client):
    before = client.get("/trips/t_demo0001/itinerary").json()
    day = before["days"][0]["date"]
    r = client.post("/trips/t_demo0001/itinerary/check",
                    json={"days": [{"date": day, "items": [_edit("10:00", "Somewhere new", *SHIBUYA, estimatedCost=100)]}]})
    assert r.status_code == 200 and r.json()["saved"] is False
    assert client.get("/trips/t_demo0001/itinerary").json() == before


# --- Stays and booked journeys -------------------------------------------------------------

BOOKINGS = {
    "stays": [{"name": "Hotel Gracery Shinjuku", "city": "Tokyo", "checkIn": "2026-12-01", "checkOut": "2026-12-04",
               "lat": 35.6948, "lng": 139.7020}],
    "transport": [
        {"kind": "train", "origin": "Tokyo", "destination": "Hakone", "departs": "2026-12-02T10:00",
         "arrives": "2026-12-02T11:30", "reference": "Romancecar"},
        {"kind": "flight", "origin": "London Heathrow", "destination": "Tokyo Haneda", "departs": "2026-11-30T19:00",
         "arrives": "2026-12-01T15:00", "reference": "BA7"},
    ],
}


@needs_db
def test_trip_keeps_bookings_and_changing_them_replans(client, monkeypatch):
    trip_id = client.post("/trips", json={**TRIP_BODY, **BOOKINGS}).json()["id"]
    got = client.get(f"/trips/{trip_id}").json()
    assert got["stays"] == [{**BOOKINGS["stays"][0], "address": None}]
    assert [t["reference"] for t in got["transport"]] == ["BA7", "Romancecar"]   # sorted by departure

    plan = _plan_with([[("10:00", 60, "Senso-ji", *ASAKUSA)], [("10:30", 60, "Park", *SHIBUYA)], QUIET_DAY, QUIET_DAY])
    prompts = []
    real_build = planner.gemini.build_prompt
    monkeypatch.setattr(planner.gemini, "generate_plan",
                        lambda trip, *a, **k: prompts.append(real_build(trip, [])) or plan.model_copy(deep=True))
    it = client.post(f"/trips/{trip_id}/itinerary").json()
    assert "Flight BA7 London Heathrow -> Tokyo Haneda" in prompts[0] and "Staying at Hotel Gracery" in prompts[0]
    day1, day2 = it["days"][0]["items"], it["days"][1]["items"]
    assert day1[0]["time"] >= "16:15"                 # lands 15:00, +75 min to get out of the airport
    assert day1[0]["travelMins"] is not None          # from the hotel
    assert day2[0]["time"] >= "11:50"                 # the 10:00-11:30 train, +20 min
    assert len(prompts) == 1                          # moving them still fits the day: no fix pass

    r = client.patch(f"/trips/{trip_id}", json={"transport": []})
    assert r.status_code == 200 and r.json()["transport"] == []
    assert client.get(f"/trips/{trip_id}/itinerary").json()["error"] == "no_itinerary"   # replanned


@needs_db
def test_bad_bookings_rejected(client):
    bad = {**TRIP_BODY, "transport": [{"origin": "A", "destination": "B", "departs": "2026-12-02T10:00",
                                       "arrives": "2026-12-02T09:00"}]}
    assert client.post("/trips", json=bad).status_code == 422
    bad = {**TRIP_BODY, "stays": [{"name": "X", "checkIn": "2026-12-03", "checkOut": "2026-12-01"}]}
    assert client.post("/trips", json=bad).status_code == 422
