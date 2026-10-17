"""Video import: link parsing, job flow, caching. Gemini is stubbed out, so no API key is needed."""
import pytest
from fastapi.testclient import TestClient

from app.errors import ApiError
from app.main import app
from app.mocks import DEMO_TRIP_ID
from app.routers import imports
from app.schemas import ImportJob, PlaceIn
from app.services import video_import
from app.services.video_import import detect_platform, youtube_video_id

client = TestClient(app)

VID = "dQw4w9WgXcQ"


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
def fake_gemini(monkeypatch):
    imports.JOBS.clear()
    imports.CACHE.clear()
    calls = []

    def fake(link, destination=None):
        calls.append((link, destination))
        return [PlaceIn(name="浅草寺", name_english="Senso-ji", category="temple", confidence=0.9,
                        source_url=link, timestamp="02:14", tip="Go early")]

    monkeypatch.setattr(video_import, "extract_places_from_youtube", fake)
    return calls


def test_youtube_import_runs_job_and_caches(fake_gemini):
    r = client.post("/imports", json={"link": f"https://youtu.be/{VID}", "tripId": DEMO_TRIP_ID})
    assert r.status_code == 202
    job = r.json()
    assert job["platform"] == "youtube"
    assert fake_gemini == [(f"https://youtu.be/{VID}", "Tokyo")]  # destination from the trip

    r = client.get(f"/imports/{job['jobId']}")  # TestClient runs background tasks before returning
    assert r.status_code == 200
    done = ImportJob.model_validate(r.json())
    assert done.status == "done"
    assert done.places[0].name_english == "Senso-ji"
    assert done.places[0].id.startswith("p_")
    assert "nameEnglish" in r.json()["places"][0]  # camelCase on the wire

    # Same video again (different link form): served from cache, no second Gemini call.
    r = client.post("/imports", json={"link": f"https://www.youtube.com/watch?v={VID}"})
    assert r.status_code == 202
    assert r.json()["status"] == "done"
    assert r.json()["places"][0]["name"] == "浅草寺"
    assert len(fake_gemini) == 1


def test_gemini_failure_marks_job_failed(monkeypatch):
    imports.CACHE.clear()

    def boom(link, destination=None):
        raise ApiError(502, "gemini_failed", "We couldn't read that video.")

    monkeypatch.setattr(video_import, "extract_places_from_youtube", boom)
    job_id = client.post("/imports", json={"link": f"https://youtu.be/{VID}"}).json()["jobId"]
    job = client.get(f"/imports/{job_id}").json()
    assert job["status"] == "failed"
    assert job["error"] == "gemini_failed"
    assert job["places"] == []


def test_tiktok_falls_back_to_paste(fake_gemini):
    r = client.post("/imports", json={"link": "https://www.tiktok.com/@a/video/1"})
    assert r.status_code == 202
    assert r.json()["status"] == "failed"
    assert r.json()["error"] == "unsupported_platform"
    assert fake_gemini == []


def test_rejects_unknown_platform_and_bad_trip(fake_gemini):
    r = client.post("/imports", json={"link": "https://example.com/video"})
    assert r.status_code == 400
    assert r.json()["error"] == "unsupported_platform"

    r = client.post("/imports", json={"link": f"https://youtu.be/{VID}", "tripId": "t_nope"})
    assert r.status_code == 404


def test_unknown_job_404():
    r = client.get("/imports/j_nope")
    assert r.status_code == 404
    assert r.json()["error"] == "not_found"


def test_missing_api_key_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(video_import, "get_settings", lambda: type("S", (), {"gemini_api_key": ""})())
    with pytest.raises(ApiError) as exc:
        video_import.extract_places_from_youtube(f"https://youtu.be/{VID}")
    assert exc.value.code == "gemini_not_configured"
