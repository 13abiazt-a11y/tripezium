"""M8 hardening: rate limits, Gemini model fallback, fix-pass time budget, no stack traces."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import ApiError
from app.main import app
from app.ratelimit import RateLimit
from app.services import gemini, hours, planner
from app.services.gemini import GDay, GItem, GItinerary
from tests.test_api import TRIP_BODY, needs_db


# --- rate limiting -----------------------------------------------------------

def _req(ip):
    return SimpleNamespace(client=SimpleNamespace(host=ip))


def test_rate_limit_blocks_after_limit_per_ip():
    limit = RateLimit("test", limit=3, window_s=60)
    for _ in range(3):
        limit(_req("1.1.1.1"))
    with pytest.raises(ApiError) as e:
        limit(_req("1.1.1.1"))
    assert (e.value.status, e.value.code) == (429, "rate_limited")
    assert "try again in" in e.value.message
    limit(_req("2.2.2.2"))  # other IPs are unaffected


def test_rate_limit_window_slides(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr("app.ratelimit.time.monotonic", lambda: clock[0])
    limit = RateLimit("test", limit=2, window_s=60)
    limit(_req("ip")); limit(_req("ip"))
    clock[0] += 61
    limit(_req("ip"))  # old hits expired


@needs_db
def test_itinerary_generation_limited_to_10_per_minute():
    client = TestClient(app)
    codes = [client.post("/trips/t_nope/itinerary").status_code for _ in range(11)]
    assert codes[:10] == [404] * 10          # counted, then 404 for the unknown trip
    r = client.post("/trips/t_nope/itinerary")
    assert r.status_code == 429
    assert r.json()["error"] == "rate_limited"
    assert client.get("/trips/t_nope/itinerary").status_code == 404   # reads aren't limited


# --- Gemini model fallback ---------------------------------------------------

class _ApiErr(Exception):
    def __init__(self, code):
        self.code = code


def _fake_client(behaviour, tried):
    class Models:
        def generate_content(self, model, contents, config):
            tried.append(model)
            outcome = behaviour.get(model, "ok")
            if outcome != "ok":
                raise _ApiErr(outcome)
            return SimpleNamespace(text="{}")
    return lambda: SimpleNamespace(models=Models())


@pytest.fixture
def three_models(monkeypatch):
    monkeypatch.setattr(gemini, "get_settings",
                        lambda: Settings(gemini_api_key="k", gemini_model="m1", gemini_fallback_models="m2,m3"))


def test_overloaded_model_falls_through_to_next(monkeypatch, three_models):
    tried = []
    monkeypatch.setattr(gemini, "_client", _fake_client({"m1": 503}, tried))
    assert gemini._call("hi") == "{}"
    assert tried == ["m1", "m2"]


def test_exhausted_model_is_skipped_on_later_calls(monkeypatch, three_models):
    tried = []
    monkeypatch.setattr(gemini, "_client", _fake_client({"m1": 429}, tried))
    gemini._call("first")
    gemini._call("second")
    assert tried == ["m1", "m2", "m2"]       # m1 not retried during its cooldown


def test_quota_cooldown_expires(monkeypatch, three_models):
    clock = [5000.0]
    monkeypatch.setattr(gemini.time, "monotonic", lambda: clock[0])
    tried = []
    monkeypatch.setattr(gemini, "_client", _fake_client({"m1": 429}, tried))
    gemini._call("first")
    clock[0] += gemini.QUOTA_COOLDOWN_S + 1
    gemini._call("later")
    assert tried == ["m1", "m2", "m1", "m2"]  # m1 tried again once its cooldown passed


def test_all_models_cooling_down_still_tries(monkeypatch, three_models):
    for m in ("m1", "m2", "m3"):
        gemini._quota_hit_at[m] = gemini.time.monotonic()
    tried = []
    monkeypatch.setattr(gemini, "_client", _fake_client({}, tried))
    assert gemini._call("hi") == "{}"         # better to ask than to fail without trying
    assert tried == ["m1"]


def test_non_retryable_error_is_raised(monkeypatch, three_models):
    tried = []
    monkeypatch.setattr(gemini, "_client", _fake_client({"m1": 400}, tried))
    with pytest.raises(_ApiErr):
        gemini._call("hi")
    assert tried == ["m1"]                    # a bad request won't get better on another model


# --- fix-pass time budget ------------------------------------------------------

@needs_db
def test_slow_first_plan_skips_fix_pass(monkeypatch):
    from app.routers import trips as trips_router
    monkeypatch.setattr(trips_router, "resolve_destination", lambda d: ("JP", "JPY"))
    monkeypatch.setattr(planner, "get_holidays", lambda db, c, s, e: [])
    monkeypatch.setattr(planner.fx, "get_rate", lambda db, b, q: (None, "test"))
    monkeypatch.setattr(planner, "FIX_PASS_BUDGET_S", -1.0)   # every first plan counts as "slow"
    client = TestClient(app)
    trip_id = client.post("/trips", json=TRIP_BODY).json()["id"]

    closed_item = dict(time="10:00", placeId=None, durationMins=60, note="", estimatedCost=0, currency="JPY",
                       status="closed", placeLat=None, placeLng=None,
                       newPlace=gemini.GNewPlace(name="Museum", nameEnglish="Museum", category="museum", lat=35, lng=139))
    plan = GItinerary(days=[GDay(date=d, items=[GItem(**closed_item)])
                            for d in ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]])
    calls = []
    monkeypatch.setattr(planner.gemini, "generate_plan", lambda *a, **k: calls.append(1) or plan)
    monkeypatch.setattr(hours, "enabled", lambda: False)

    data = client.post(f"/trips/{trip_id}/itinerary").json()
    assert len(calls) == 1                                      # no second Gemini call
    assert data["days"][0]["items"][0]["status"] == "closed"     # shown honestly instead


# --- no stack traces ---------------------------------------------------------------

def test_unexpected_error_returns_json_not_a_stack_trace():
    @app.get("/__boom_for_test")
    def boom():
        raise RuntimeError("secret internals: password=hunter2")
    try:
        r = TestClient(app, raise_server_exceptions=False).get("/__boom_for_test")
    finally:
        app.router.routes = [rt for rt in app.router.routes if getattr(rt, "path", "") != "/__boom_for_test"]
    assert r.status_code == 500
    assert r.json() == {"error": "internal_error", "message": "Something went wrong on our side."}
    assert "Traceback" not in r.text and "hunter2" not in r.text


# --- overall Gemini deadline -------------------------------------------------------

def test_no_call_started_when_deadline_too_close(monkeypatch, three_models):
    tried = []
    monkeypatch.setattr(gemini, "_client", _fake_client({}, tried))
    with gemini.deadline(gemini.MIN_TIME_FOR_A_CALL_S - 1):
        with pytest.raises(ApiError) as e:
            gemini._call("hi")
    assert (e.value.status, e.value.code) == (503, "gemini_busy")
    assert tried == []


def test_slow_failing_model_stops_fallback_at_deadline(monkeypatch, three_models):
    clock = [0.0]
    monkeypatch.setattr(gemini.time, "monotonic", lambda: clock[0])
    tried = []

    class Models:
        def generate_content(self, model, contents, config):
            tried.append(model)
            clock[0] += 60          # each overloaded model burns a full timeout
            raise _ApiErr(504)
    monkeypatch.setattr(gemini, "_client", lambda: SimpleNamespace(models=Models()))
    with gemini.deadline(100):
        with pytest.raises(ApiError) as e:
            gemini._call("hi")
    assert e.value.code == "gemini_busy"
    # m1 burns 60s (40s left, enough to try m2); m2 burns 60s more (past the deadline): m3 never starts
    assert tried == ["m1", "m2"]


def test_deadline_is_per_request_and_unset_outside(monkeypatch, three_models):
    tried = []
    monkeypatch.setattr(gemini, "_client", _fake_client({}, tried))
    with gemini.deadline(1000):
        pass
    assert gemini._call("hi") == "{}"   # no deadline leaks out of the with-block


# --- CORS ---------------------------------------------------------------------------

@pytest.mark.parametrize("origin, allowed", [
    ("https://tripezium-git-c-frontend-wiring-iku.vercel.app", True),   # Vercel preview
    ("https://tripezium-abc123-iku.vercel.app", True),
    ("https://tripezium.vercel.app", True),
    ("https://evil.vercel.app", False),
    ("https://tripezium.vercel.app.evil.com", False),
    ("http://tripezium-x.vercel.app", False),                            # https only
])
def test_cors_allows_vercel_previews_only(origin, allowed):
    r = TestClient(app).options("/trips", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
    assert (r.headers.get("access-control-allow-origin") == origin) is allowed


# --- one generation per trip at a time ---------------------------------------------

@needs_db
def test_concurrent_generate_requests_share_one_generation(monkeypatch):
    import threading
    import time as _time

    from app.routers import trips as trips_router
    from tests.test_api import _fake_plan
    monkeypatch.setattr(trips_router, "resolve_destination", lambda d: ("JP", "JPY"))
    monkeypatch.setattr(planner, "get_holidays", lambda db, c, s, e: [])
    monkeypatch.setattr(planner.fx, "get_rate", lambda db, b, q: (None, "test"))
    monkeypatch.setattr(hours, "enabled", lambda: False)

    trip_id = TestClient(app).post("/trips", json=TRIP_BODY).json()["id"]
    imported = TestClient(app).post(f"/trips/{trip_id}/places", json={"places": [{"name": "Senso-ji"}]}).json()["places"][0]

    calls = []
    def slow_generate(*a, **k):
        calls.append(1)
        _time.sleep(1.5)                      # a slow Gemini call
        return _fake_plan(imported["id"])
    monkeypatch.setattr(planner.gemini, "generate_plan", slow_generate)

    results = []
    def ask():
        results.append(TestClient(app).post(f"/trips/{trip_id}/itinerary"))
    threads = [threading.Thread(target=ask) for _ in range(3)]
    for t in threads:
        t.start(); _time.sleep(0.1)
    for t in threads:
        t.join()

    assert [r.status_code for r in results] == [200, 200, 200]
    assert len(calls) == 1                                       # Gemini asked once, not three times
    assert results[0].json() == results[1].json() == results[2].json()

    TestClient(app).post(f"/trips/{trip_id}/itinerary")         # a later request regenerates as normal
    assert len(calls) == 2
