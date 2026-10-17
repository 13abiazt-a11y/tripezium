"""M1: every mock endpoint returns JSON that matches the contract."""
from decimal import Decimal

from fastapi.testclient import TestClient

from app.main import app
from app.mocks import DEMO_TRIP_ID
from app.schemas import Itinerary, Trip

client = TestClient(app)

TRIP_BODY = {
    "destination": "Tokyo", "startDate": "2026-12-01", "endDate": "2026-12-04",
    "dayStart": "09:00", "dayEnd": "21:00", "travellers": 2,
    "interests": ["food", "temples", "nightlife"], "homeCurrency": "GBP",
}


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_create_and_get_trip_round_trip():
    r = client.post("/trips", json=TRIP_BODY)
    assert r.status_code == 201
    created = r.json()
    assert created["id"].startswith("t_")
    assert {k: created[k] for k in TRIP_BODY} == TRIP_BODY  # camelCase in, camelCase out

    r = client.get(f"/trips/{created['id']}")
    assert r.status_code == 200
    assert r.json() == created


def test_validation_error_format():
    r = client.post("/trips", json={**TRIP_BODY, "endDate": "2026-11-01"})
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "validation_error"
    assert "endDate" in body["message"]


def test_not_found_format():
    r = client.get("/trips/t_nope")
    assert r.status_code == 404
    assert r.json() == {"error": "not_found", "message": "Trip 't_nope' not found"}


def test_unknown_route_uses_error_format():
    r = client.get("/nope")
    assert r.status_code == 404
    assert set(r.json()) == {"error", "message"}


def test_save_places_assigns_ids():
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]
    r = client.post(f"/trips/{trip_id}/places", json={"places": [
        {"id": "p1", "name": "Senso-ji", "nameEnglish": "Senso-ji", "category": "temple",
         "lat": 35.7148, "lng": 139.7967, "confidence": 0.9,
         "sourceUrl": "https://youtube.com/x", "timestamp": "02:14", "tip": "Go early"},
        {"name": "Somewhere with no coords"},
    ]})
    assert r.status_code == 200
    places = r.json()["places"]
    assert places[0]["id"] == "p1"
    assert places[0]["nameEnglish"] == "Senso-ji"
    assert places[1]["id"].startswith("p_")
    assert places[1]["lat"] is None


def test_place_bad_lat_rejected():
    r = client.post(f"/trips/{DEMO_TRIP_ID}/places", json={"places": [{"name": "x", "lat": 120}]})
    assert r.status_code == 422


def test_itinerary_matches_contract_and_totals_add_up():
    for method in (client.post, client.get):
        r = method(f"/trips/{DEMO_TRIP_ID}/itinerary")
        assert r.status_code == 200
        data = r.json()
        Itinerary.model_validate(data)  # contract shape
        assert data["homeCurrency"] == "GBP"

        day_sum = Decimal(0)
        for day in data["days"]:
            items_sum = sum(Decimal(str(i["costHome"])) for i in day["items"])
            assert items_sum == Decimal(str(day["dayTotalHome"]))
            day_sum += Decimal(str(day["dayTotalHome"]))
        assert day_sum == Decimal(str(data["tripTotalHome"]))

        new_years = next(d for d in data["days"] if d["date"] == "2027-01-01")
        assert new_years["holiday"] == "New Year's Day"
        statuses = {i["status"] for d in data["days"] for i in d["items"]}
        assert statuses == {"ok", "check_hours", "closed"}


def test_demo_trip_exists():
    r = client.get(f"/trips/{DEMO_TRIP_ID}")
    assert r.status_code == 200
    Trip.model_validate(r.json())
