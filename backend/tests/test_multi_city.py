"""Multi-city trips: the route contract, which city each day is in, and how the itinerary and
import use it. Network calls (Gemini, Nominatim, Nager.Date, Google) are all stubbed."""
import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.config import Settings, get_settings
from app.db import _session_factory, check_db
from app.errors import ApiError
from app.main import app
from app.models import TripRow
from app.routers import imports
from app.routers import trips as trips_router
from app.schemas import PlaceIn
from app.services import gemini, geo, import_cache, planner, route, video_import
from app.services.gemini import GDay, GItem, GItinerary, GNewPlace
from app.services.holidays import Holiday

_url = get_settings().database_url
needs_db = pytest.mark.skipif(not (_url and "<password>" not in _url and check_db() == "ok"),
                              reason="DATABASE_URL not set or unreachable")

# Paris 2 days, Lyon 1, Rome 2 = 5 days, 1-5 Dec 2026 (the front end's RouteStop shape, plus cityId it sends)
ROUTE = [
    {"cityId": "a1", "city": "Paris", "country": "FR", "days": 2},
    {"cityId": "a2", "city": "Lyon", "country": "FR", "days": 1},
    {"cityId": "a3", "city": "Rome", "country": "IT", "days": 2},
]
BODY = {
    "destination": "pytest-France & Italy", "startDate": "2026-12-01", "endDate": "2026-12-05",
    "dayStart": "09:00", "dayEnd": "21:00", "travellers": 2, "interests": ["food"], "homeCurrency": "GBP",
    "route": ROUTE,
}


def make_trip(route_legs=None, **kw) -> TripRow:
    base = dict(id="t_mc", destination="France & Italy", country_code="FR", local_currency="EUR",
                start_date=dt.date(2026, 12, 1), end_date=dt.date(2026, 12, 5),
                day_start=dt.time(9), day_end=dt.time(21), travellers=2, interests=["food"], home_currency="GBP",
                route=[{**leg, "currency": "EUR"} for leg in (route_legs or [])])
    return TripRow(**{**base, **kw})


MULTI = make_trip([{k: v for k, v in leg.items() if k != "cityId"} for leg in ROUTE])
SINGLE = make_trip(destination="Tokyo", country_code="JP", local_currency="JPY", route=[])


# --- route helper -------------------------------------------------------------

def test_day_legs_follow_the_route():
    days = [(d.isoformat(), leg.city) for d, leg in route.day_legs(MULTI)]
    assert days == [("2026-12-01", "Paris"), ("2026-12-02", "Paris"), ("2026-12-03", "Lyon"),
                    ("2026-12-04", "Rome"), ("2026-12-05", "Rome")]
    assert route.cities(MULTI) == ["Paris", "Lyon", "Rome"]
    assert route.describe(route.cities(MULTI)) == "Paris, Lyon and Rome"
    assert route.single_country(MULTI) is None
    assert route.is_multi_city(MULTI)


def test_trip_without_route_is_one_leg():
    for trip in (SINGLE, make_trip(route=None, destination="Tokyo")):  # None = a TripRow built in code, not loaded
        [leg] = route.legs(trip)
        assert (leg.city, leg.days) == ("Tokyo", 5)
        assert not route.is_multi_city(trip)
    assert route.single_country(SINGLE) == "JP"


def test_short_route_runs_the_last_leg_on():
    trip = make_trip([{"city": "Paris", "country": "FR", "days": 2}])
    assert [leg.city for _, leg in route.day_legs(trip)] == ["Paris"] * 5


# --- itinerary prompt ---------------------------------------------------------

def test_prompt_lists_each_days_city():
    prompt = gemini.build_prompt(MULTI, [])
    assert "Route, in travel order: Paris (FR, 2 days) -> Lyon (FR, 1 day) -> Rome (IT, 2 days)" in prompt
    assert "- 2026-12-03 (Thu): Lyon, FR" in prompt
    assert "must be in or near THAT date's city" in prompt
    assert "Paris: EUR" in prompt


def test_single_city_prompt_unchanged():
    prompt = gemini.build_prompt(SINGLE, [])
    assert "- Destination: Tokyo, country JP" in prompt
    assert "Route, in travel order" not in prompt and "THAT date's city" not in prompt


def test_holidays_only_on_days_in_that_country(monkeypatch):
    asked = []

    def fake(db, country, start, end):
        asked.append((country, start, end))
        return [Holiday(dt.date(2026, 12, 2), "French day"), Holiday(dt.date(2026, 12, 4), "French day 2")] \
            if country == "FR" else [Holiday(dt.date(2026, 12, 1), "Italian day"), Holiday(dt.date(2026, 12, 5), "Italian day 2")]

    monkeypatch.setattr(planner, "get_holidays", fake)
    got = [(h.date.isoformat(), h.name) for h in planner.trip_holidays(None, MULTI)]
    # 4 Dec is in Rome, 1 Dec in Paris: those holidays don't apply. Country named when there are several.
    assert got == [("2026-12-02", "French day (FR)"), ("2026-12-05", "Italian day 2 (IT)")]
    assert asked == [("FR", dt.date(2026, 12, 1), dt.date(2026, 12, 3)), ("IT", dt.date(2026, 12, 4), dt.date(2026, 12, 5))]


def test_hours_lookups_use_each_days_city(monkeypatch):
    seen = []
    monkeypatch.setattr(planner.hours, "enabled", lambda: True)
    monkeypatch.setattr(planner.hours, "lookup_all", lambda stops, dest: seen.extend(stops) or {})
    place = GNewPlace(name="Louvre", nameEnglish="Louvre", category="museum", lat=48.86, lng=2.34)
    item = GItem(time="10:00", placeId=None, newPlace=place, durationMins=60, note="", estimatedCost=0,
                 currency="EUR", status="ok", placeLat=None, placeLng=None)
    plan = GItinerary(days=[GDay(date=d.isoformat(), items=[item]) for d, _ in route.day_legs(MULTI)])
    planner.check_hours(MULTI, plan, {})
    assert {s.city for s in seen} == {"Paris", "Lyon", "Rome"}


# --- quota fallback for the itinerary ----------------------------------------

class _Quota(Exception):
    code = 429


def test_itinerary_call_falls_back_on_quota(monkeypatch):
    tried = []

    class Models:
        def generate_content(self, model, contents, config):
            tried.append(model)
            if model != "m2":
                raise _Quota()
            return type("R", (), {"text": "{}"})()

    monkeypatch.setattr(gemini, "_client", lambda: type("C", (), {"models": Models()})())
    monkeypatch.setattr(gemini, "get_settings", lambda: Settings(gemini_model="m1", gemini_fallback_models="m2,m3"))
    assert gemini._call("hi") == "{}"
    assert tried == ["m1", "m2"]


def test_itinerary_all_models_out_of_quota(monkeypatch):
    class Models:
        def generate_content(self, model, contents, config):
            raise _Quota()

    monkeypatch.setattr(gemini, "_client", lambda: type("C", (), {"models": Models()})())
    monkeypatch.setattr(gemini, "get_settings",
                        lambda: Settings(gemini_api_key="k", gemini_model="m1", gemini_fallback_models="m2"))
    with pytest.raises(ApiError) as exc:
        gemini.generate_plan(SINGLE, [])
    assert exc.value.code == "gemini_quota"  # not retried as "generation_failed"


# --- import -------------------------------------------------------------------

def test_geocoding_on_a_multi_city_trip(monkeypatch):
    queries = []
    known = {"paris": (48.86, 2.35), "rome": (41.90, 12.50), "lyon": (45.76, 4.84),
             "trevi fountain, rome": (41.90, 12.48), "louvre": (48.86, 2.34)}

    def fake(query, country_code=None):
        queries.append(query)
        hit = known.get(query.lower())
        return {"lat": hit[0], "lng": hit[1], "country_code": None} if hit else None

    monkeypatch.setattr(geo, "geocode", fake)
    trevi, louvre = video_import.geocode_places(
        [PlaceIn(name="Trevi Fountain", city="Rome", confidence=0.9), PlaceIn(name="Louvre", confidence=0.9)],
        ["Paris", "Lyon", "Rome"])
    assert (trevi.lat, trevi.confidence) == (41.90, 0.9)  # near Rome, a trip city: not "far"
    assert (louvre.lat, louvre.confidence) == (48.86, 0.9)
    assert not any(q.startswith("Louvre, ") for q in queries)  # no city known: never guess one of the trip's


@needs_db
class TestWithDatabase:
    @pytest.fixture(autouse=True)
    def _setup(self, monkeypatch):
        monkeypatch.setattr(trips_router, "resolve_destination", lambda d: pytest.fail("route trips skip Nominatim"))
        monkeypatch.setattr(import_cache, "_db_enabled", lambda: False)
        import_cache.clear_memory()
        imports.JOBS.clear()
        self.client = TestClient(app)
        yield
        with _session_factory()() as db:
            db.execute(delete(TripRow).where(TripRow.destination.like("pytest-%")))
            db.commit()

    def test_create_trip_with_route(self):
        r = self.client.post("/trips", json=BODY)
        assert r.status_code == 201, r.text
        trip = r.json()
        assert trip["route"] == [{k: v for k, v in leg.items() if k != "cityId"} for leg in ROUTE]
        assert self.client.get(f"/trips/{trip['id']}").json() == trip
        with _session_factory()() as db:
            row = db.get(TripRow, trip["id"])
            assert [leg["currency"] for leg in row.route] == ["EUR", "EUR", "EUR"]
            assert (row.country_code, row.local_currency) == ("FR", "EUR")

    def test_route_must_cover_the_trip(self):
        r = self.client.post("/trips", json={**BODY, "route": ROUTE[:2]})
        assert r.status_code == 422
        assert "route days add up to 3, but the trip is 5 days" in r.json()["message"]
        bad = [{**ROUTE[0], "country": "France", "days": 5}]
        assert self.client.post("/trips", json={**BODY, "route": bad}).status_code == 422

    def test_import_gets_every_city(self, monkeypatch):
        trip_id = self.client.post("/trips", json=BODY).json()["id"]
        seen = {}
        monkeypatch.setattr(video_import, "extract_places_from_text",
                            lambda text, destination=None, source_url=None, images=(): seen.setdefault("dest", destination) and [])
        monkeypatch.setattr(video_import, "geocode_places",
                            lambda places, cities, country=None: seen.update(cities=cities, country=country) or places)
        r = self.client.post("/imports/text", json={"text": "Louvre then Trevi", "tripId": trip_id})
        assert r.status_code == 202
        assert seen == {"dest": "Paris, Lyon and Rome", "cities": ["Paris", "Lyon", "Rome"], "country": None}
