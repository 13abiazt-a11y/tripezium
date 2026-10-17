"""Video import: link parsing, job flow, caching, geocoding.

Gemini and Nominatim are stubbed out, so no API key or network is needed. Tests that send a
tripId need the database (the demo trip from seed_demo.py) and are skipped without it.
"""
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import check_db
from app.errors import ApiError
from app.main import app
from app.mocks import DEMO_TRIP_ID
from app.routers import imports
from app.schemas import ImportJob, PlaceIn
from app.services import geo, video_import
from app.services.video_import import detect_platform, geocode_places, youtube_video_id

client = TestClient(app)

_url = get_settings().database_url
needs_db = pytest.mark.skipif(not (_url and "<password>" not in _url and check_db() == "ok"),
                              reason="DATABASE_URL not set or unreachable")

VID = "dQw4w9WgXcQ"

TOKYO = {"lat": 35.68, "lng": 139.76, "country_code": "JP"}
SENSOJI = {"lat": 35.7148, "lng": 139.7967, "country_code": "JP"}


@pytest.mark.parametrize("link", [
    f"https://www.youtube.com/watch?v={VID}",
    f"https://youtube.com/watch?v={VID}&t=42s",
    f"https://m.youtube.com/watch?v={VID}",
    f"https://youtu.be/{VID}?si=abc",
    f"https://www.youtube.com/shorts/{VID}",
    f"https://www.youtube.com/embed/{VID}",
    f"  https://www.youtube.com/live/{VID}  ",
])
def test_youtube_links(link):
    assert detect_platform(link) == "youtube"
    assert youtube_video_id(link) == VID


@pytest.mark.parametrize("link,platform", [
    ("https://www.tiktok.com/@someone/video/7300000000000000000", "tiktok"),
    ("https://vm.tiktok.com/ZMabc123/", "tiktok"),
    ("https://example.com/watch?v=" + VID, "unknown"),
    ("not a link", "unknown"),
])
def test_other_platforms(link, platform):
    assert detect_platform(link) == platform


def test_bad_youtube_ids():
    assert youtube_video_id("https://www.youtube.com/watch?v=short") is None
    assert youtube_video_id("https://www.youtube.com/@channel") is None


@pytest.fixture
def fake_geocoder(monkeypatch):
    """Knows Tokyo and Senso-ji; everything else is 'not found'."""
    queries = []

    def fake(query, country_code=None):
        queries.append((query, country_code))
        q = query.lower()
        if q.startswith("senso-ji"):
            return SENSOJI
        if q == "tokyo":
            return TOKYO
        if q.startswith("far away"):
            return {"lat": 34.69, "lng": 135.50, "country_code": "JP"}  # Osaka, ~400 km
        return None

    monkeypatch.setattr(geo, "geocode", fake)
    return queries


@pytest.fixture
def fake_gemini(monkeypatch, fake_geocoder):
    imports.JOBS.clear()
    imports.CACHE.clear()
    calls = []

    def fake(link, destination=None):
        calls.append((link, destination))
        return [PlaceIn(name="浅草寺", name_english="Senso-ji", category="temple", confidence=0.9,
                        source_url=link, timestamp="02:14", tip="Go early")]

    monkeypatch.setattr(video_import, "extract_places_from_youtube", fake)
    return calls


def _import(body):
    r = client.post("/imports", json=body)
    assert r.status_code == 202
    job = r.json()
    return job, client.get(f"/imports/{job['jobId']}").json()  # TestClient runs background tasks first


def test_youtube_import_runs_job_and_caches(fake_gemini):
    job, done = _import({"link": f"https://youtu.be/{VID}"})
    assert job["status"] == "pending"
    assert job["platform"] == "youtube"
    assert fake_gemini == [(f"https://youtu.be/{VID}", None)]

    done = ImportJob.model_validate(done)
    assert done.status == "done"
    assert done.places[0].name_english == "Senso-ji"
    assert done.places[0].id.startswith("p_")

    # Same video again (different link form): Gemini isn't called a second time.
    _, again = _import({"link": f"https://www.youtube.com/watch?v={VID}"})
    assert again["status"] == "done"
    assert again["places"][0]["name"] == "浅草寺"
    assert "nameEnglish" in again["places"][0]  # camelCase on the wire
    assert len(fake_gemini) == 1


@needs_db
def test_import_with_trip_uses_destination_and_geocodes(fake_gemini, fake_geocoder):
    _, done = _import({"link": f"https://youtu.be/{VID}", "tripId": DEMO_TRIP_ID})
    assert fake_gemini == [(f"https://youtu.be/{VID}", "Tokyo")]
    place = done["places"][0]
    assert (place["lat"], place["lng"]) == (SENSOJI["lat"], SENSOJI["lng"])
    assert place["confidence"] == 0.9
    assert ("Senso-ji, Tokyo", "JP") in fake_geocoder  # destination as context, country from the trip


@needs_db
def test_unknown_trip_404(fake_gemini):
    r = client.post("/imports", json={"link": f"https://youtu.be/{VID}", "tripId": "t_nope"})
    assert r.status_code == 404
    assert r.json()["error"] == "not_found"


def test_geocode_places(fake_geocoder):
    places = [
        PlaceIn(name="浅草寺", name_english="Senso-ji", confidence=0.9),
        PlaceIn(name="Nowhere Cafe", confidence=0.8),
        PlaceIn(name="Far Away Castle", confidence=1.0),
    ]
    found, missing, far = geocode_places(places, "Tokyo")
    assert (found.lat, found.lng, found.confidence) == (35.7148, 139.7967, 0.9)
    assert (missing.lat, missing.lng, missing.confidence) == (None, None, 0.4)  # not found: halved
    assert far.lat == 34.69 and far.confidence == 0.5  # > 150 km from Tokyo: halved
    assert ("Tokyo", None) in fake_geocoder
    assert ("Senso-ji, Tokyo", "JP") in fake_geocoder  # country taken from the destination


def test_gemini_failure_marks_job_failed(monkeypatch, fake_geocoder):
    imports.CACHE.clear()

    def boom(link, destination=None):
        raise ApiError(502, "gemini_failed", "We couldn't read that video.")

    monkeypatch.setattr(video_import, "extract_places_from_youtube", boom)
    _, job = _import({"link": f"https://youtu.be/{VID}"})
    assert job["status"] == "failed"
    assert job["error"] == "gemini_failed"
    assert job["places"] == []


def test_tiktok_falls_back_to_paste(fake_gemini):
    r = client.post("/imports", json={"link": "https://www.tiktok.com/@a/video/1"})
    assert r.status_code == 202
    assert r.json()["status"] == "failed"
    assert r.json()["error"] == "unsupported_platform"
    assert fake_gemini == []


def test_rejects_unknown_platform(fake_gemini):
    r = client.post("/imports", json={"link": "https://example.com/video"})
    assert r.status_code == 400
    assert r.json()["error"] == "unsupported_platform"


def test_unknown_job_404():
    r = client.get("/imports/j_nope")
    assert r.status_code == 404
    assert r.json()["error"] == "not_found"


def test_missing_api_key_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(video_import, "get_settings", lambda: type("S", (), {"gemini_api_key": ""})())
    with pytest.raises(ApiError) as exc:
        video_import.extract_places_from_youtube(f"https://youtu.be/{VID}")
    assert exc.value.code == "gemini_not_configured"
