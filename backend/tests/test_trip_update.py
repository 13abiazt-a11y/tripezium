"""Real-city checks on routes, and PATCH /trips/{id}."""
import pytest
from sqlalchemy import delete, select

from app.db import _session_factory
from app.models import ItineraryRow, PlaceRow, TripRow
from app.services import cities, planner
from tests.test_api import DB_READY, TRIP_BODY, _fake_plan, client, needs_db  # noqa: F401  (client is a fixture)


@pytest.fixture(autouse=True, scope="module")
def _cleanup():
    """Trips made here are named "pytest-..."; delete them afterwards (test_api's cleanup only covers its own file)."""
    yield
    if DB_READY:
        with _session_factory()() as db:
            db.execute(delete(TripRow).where(TripRow.destination.like("pytest-%")))
            db.commit()

ROUTE_TRIP = {**TRIP_BODY, "destination": "pytest-Japan",
              "route": [{"city": "Tokyo", "country": "JP", "days": 2}, {"city": "Kyoto", "country": "JP", "days": 2}]}


# --- the city check itself (no DB) --------------------------------------------------

def test_known_cities_get_the_lists_spelling():
    assert cities.canonical_city("JP", "kyoto") == "Kyoto"
    assert cities.canonical_city("JP", "Kyōto") == "Kyoto"       # accents ignored, like the dropdown
    assert cities.canonical_city("ES", "malaga") == "Málaga"
    assert cities.canonical_city("JP", "  TOKYO ") == "Tokyo"


def test_made_up_or_misplaced_cities_are_rejected():
    assert cities.canonical_city("JP", "Atlantis") is None
    assert cities.canonical_city("JP", "Kyotoo") is None
    assert cities.canonical_city("FR", "Rome") is None              # real city, wrong country


def test_country_without_a_list_is_not_blocked():
    assert cities.canonical_city("ZZ", "Somewhere") == "Somewhere"


def test_norm_matches_the_front_end():
    assert cities.norm("  Ho Chi Minh CITY ") == "ho chi minh city"
    assert cities.norm("São Paulo") == "sao paulo"


# --- POST /trips with a route ------------------------------------------------------

@needs_db
def test_create_rejects_unknown_city(client):
    body = {**ROUTE_TRIP, "route": [{"city": "Tokyo", "country": "JP", "days": 2},
                                    {"city": "Atlantis", "country": "JP", "days": 2}]}
    r = client.post("/trips", json=body)
    assert r.status_code == 422
    assert r.json()["error"] == "unknown_city"
    assert "Atlantis" in r.json()["message"]


@needs_db
def test_create_saves_the_lists_spelling(client):
    body = {**ROUTE_TRIP, "route": [{"city": "tokyo", "country": "JP", "days": 2},
                                    {"city": "KYŌTO", "country": "JP", "days": 2}]}
    r = client.post("/trips", json=body)
    assert r.status_code == 201
    assert [leg["city"] for leg in r.json()["route"]] == ["Tokyo", "Kyoto"]


# --- PATCH /trips/{id} -------------------------------------------------------------

def _trip_with_itinerary(client, monkeypatch):
    """A trip with one imported place and a generated (fake) itinerary."""
    trip = client.post("/trips", json=TRIP_BODY).json()
    imported = client.post(f"/trips/{trip['id']}/places", json={"places": [{"name": "Senso-ji"}]}).json()["places"][0]
    monkeypatch.setattr(planner.gemini, "generate_plan", lambda *a, **k: _fake_plan(imported["id"]))
    assert client.post(f"/trips/{trip['id']}/itinerary").status_code == 200
    return trip, imported


def _counts(trip_id):
    with _session_factory()() as db:
        has_itinerary = db.get(ItineraryRow, trip_id) is not None
        origins = [p.origin for p in db.scalars(select(PlaceRow).where(PlaceRow.trip_id == trip_id))]
    return has_itinerary, origins.count("import"), origins.count("ai")


@needs_db
def test_patch_changes_only_what_is_sent(client):
    trip = client.post("/trips", json=TRIP_BODY).json()
    r = client.patch(f"/trips/{trip['id']}", json={"interests": ["museums"], "dayEnd": "22:00"})
    assert r.status_code == 200
    assert r.json() == {**trip, "interests": ["museums"], "dayEnd": "22:00"}
    assert client.get(f"/trips/{trip['id']}").json() == r.json()   # persisted


@needs_db
def test_patch_that_changes_the_plan_clears_the_old_itinerary(client, monkeypatch):
    trip, _ = _trip_with_itinerary(client, monkeypatch)
    assert _counts(trip["id"]) == (True, 1, 4)
    client.patch(f"/trips/{trip['id']}", json={"interests": ["food", "art"]})
    assert _counts(trip["id"]) == (False, 1, 0)        # itinerary + AI stops gone, imported place kept
    assert client.get(f"/trips/{trip['id']}/itinerary").json()["error"] == "no_itinerary"


@needs_db
def test_patch_travellers_keeps_the_itinerary(client, monkeypatch):
    trip, _ = _trip_with_itinerary(client, monkeypatch)
    r = client.patch(f"/trips/{trip['id']}", json={"travellers": 4})
    assert r.json()["travellers"] == 4
    assert _counts(trip["id"]) == (True, 1, 4)         # costs are per person: plan still valid


@needs_db
def test_patch_same_value_keeps_the_itinerary(client, monkeypatch):
    trip, _ = _trip_with_itinerary(client, monkeypatch)
    client.patch(f"/trips/{trip['id']}", json={"interests": trip["interests"]})
    assert _counts(trip["id"])[0] is True


@needs_db
def test_patch_route_is_validated_like_a_new_trip(client):
    trip = client.post("/trips", json=ROUTE_TRIP).json()
    url = f"/trips/{trip['id']}"

    r = client.patch(url, json={"route": [{"city": "Tokyo", "country": "JP", "days": 3}]})   # 3 != 4 days
    assert r.status_code == 422 and r.json()["error"] == "validation_error"
    assert "route days add up to 3" in r.json()["message"]

    r = client.patch(url, json={"route": [{"city": "Tokyo", "country": "JP", "days": 2},
                                          {"city": "Narnia", "country": "JP", "days": 2}]})
    assert r.status_code == 422 and r.json()["error"] == "unknown_city"

    r = client.patch(url, json={"route": [{"city": "osaka", "country": "JP", "days": 4}]})
    assert r.status_code == 200 and r.json()["route"] == [{"city": "Osaka", "country": "JP", "days": 4}]

    # dates and route together: shorten the trip and the route in one call
    r = client.patch(url, json={"endDate": "2026-12-02", "route": [{"city": "Osaka", "country": "JP", "days": 2}]})
    assert r.status_code == 200 and r.json()["endDate"] == "2026-12-02"


@needs_db
def test_patch_invalid_dates_rejected(client):
    trip = client.post("/trips", json=TRIP_BODY).json()
    r = client.patch(f"/trips/{trip['id']}", json={"endDate": "2026-11-01"})
    assert r.status_code == 422
    assert "endDate must be on or after startDate" in r.json()["message"]
    assert client.get(f"/trips/{trip['id']}").json() == trip   # nothing saved


@needs_db
def test_patch_empty_body_is_a_no_op(client):
    trip = client.post("/trips", json=TRIP_BODY).json()
    assert client.patch(f"/trips/{trip['id']}", json={}).json() == trip


@needs_db
def test_patch_unknown_trip_404(client):
    r = client.patch("/trips/t_nope", json={"travellers": 2})
    assert r.status_code == 404 and r.json()["error"] == "not_found"


@needs_db
def test_demo_trip_cannot_be_patched(client):
    r = client.patch("/trips/t_demo0001", json={"travellers": 9})
    assert r.status_code == 403 and r.json()["error"] == "read_only"


# --- POST /places after an itinerary exists ------------------------------------------

@needs_db
def test_new_imported_places_make_the_old_itinerary_stale(client, monkeypatch):
    trip, _ = _trip_with_itinerary(client, monkeypatch)
    assert _counts(trip["id"]) == (True, 1, 4)
    r = client.post(f"/trips/{trip['id']}/places", json={"places": [{"name": "Golden Gai", "confidence": 0.9}]})
    assert r.status_code == 200
    assert _counts(trip["id"]) == (False, 2, 0)        # plan dropped so the new must-see gets included
    assert client.get(f"/trips/{trip['id']}/itinerary").json()["error"] == "no_itinerary"


@needs_db
def test_demo_trip_rejects_imports(client):
    r = client.post("/trips/t_demo0001/places", json={"places": [{"name": "Somewhere"}]})
    assert r.status_code == 403 and r.json()["error"] == "read_only"
    assert client.get("/trips/t_demo0001/itinerary").status_code == 200   # demo itinerary untouched
