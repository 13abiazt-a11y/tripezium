"""API tests against the real database. Skipped if DATABASE_URL isn't usable.

Every trip created here has a destination starting "pytest-" and is deleted afterwards.
Geocoding is faked so the tests never call Nominatim.
"""
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.config import get_settings
from app.db import _session_factory, check_db
from app.main import app
from app.mocks import demo_itinerary
from app.models import TripRow
from app.routers import trips as trips_router
from app.schemas import Itinerary

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
    monkeypatch.setattr(trips_router, "resolve_destination", lambda d: ("JP", "JPY"))
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


@needs_db
def test_itinerary_endpoint_returns_contract(client):
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    r = client.post(f"/trips/{trip_id}/itinerary")
    assert r.status_code == 200
    Itinerary.model_validate(r.json())


def test_mock_itinerary_totals_add_up():
    data = demo_itinerary().model_dump(by_alias=True, mode="json")
    day_sum = Decimal(0)
    for day in data["days"]:
        assert sum(Decimal(str(i["costHome"])) for i in day["items"]) == Decimal(str(day["dayTotalHome"]))
        day_sum += Decimal(str(day["dayTotalHome"]))
    assert day_sum == Decimal(str(data["tripTotalHome"]))
    assert next(d for d in data["days"] if d["date"] == "2027-01-01")["holiday"] == "New Year's Day"
    assert {i["status"] for d in data["days"] for i in d["items"]} == {"ok", "check_hours", "closed"}
