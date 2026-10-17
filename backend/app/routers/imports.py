"""POST /imports starts a background job; GET /imports/{jobId} polls it.

Jobs and the per-video cache live in memory for now (like the M1 mocks).
"""
import logging
import threading

from fastapi import APIRouter, BackgroundTasks

from ..db import _session_factory
from ..errors import ApiError, not_found
from ..ids import new_id
from ..schemas import ImportCreate, ImportJob, Place, PlaceIn
from ..services import video_import
from .trips import get_trip_or_404

log = logging.getLogger("app.imports")

router = APIRouter(prefix="/imports", tags=["imports"])

JOBS: dict[str, ImportJob] = {}
CACHE: dict[str, list[PlaceIn]] = {}  # "youtube:<videoId>" -> places straight from Gemini
_lock = threading.Lock()


def _with_ids(places: list[PlaceIn]) -> list[Place]:
    # Fresh ids per job, so the review screen can key checkboxes and POST /trips/{id}/places upserts.
    return [Place(**{**p.model_dump(), "id": new_id("p")}) for p in places]


def _update(job_id: str, **changes) -> None:
    with _lock:
        JOBS[job_id] = JOBS[job_id].model_copy(update=changes)


def _run_youtube(job_id: str, link: str, cache_key: str,
                 destination: str | None, country_code: str | None) -> None:
    _update(job_id, status="running")
    try:
        places = CACHE.get(cache_key)
        if places is None:
            places = video_import.extract_places_from_youtube(link, destination)
            CACHE[cache_key] = places  # raw Gemini output; geocoding is cached separately per query
        places = video_import.geocode_places(places, destination, country_code)
    except ApiError as exc:
        _update(job_id, status="failed", error=exc.code, message=exc.message)
        return
    except Exception:
        log.exception("import job %s crashed", job_id)
        _update(job_id, status="failed", error="internal_error",
                message="Something went wrong reading that video. Try pasting the caption instead.")
        return
    _update(job_id, status="done", places=_with_ids(places))


def _trip_context(trip_id: str) -> tuple[str, str | None]:
    """(destination, country code) for the trip. Only touches the DB when a tripId is sent."""
    with _session_factory()() as db:
        trip = get_trip_or_404(db, trip_id)
        return trip.destination, trip.country_code


@router.post("", response_model=ImportJob, status_code=202)
def create_import(body: ImportCreate, background: BackgroundTasks) -> ImportJob:
    destination, country_code = _trip_context(body.trip_id) if body.trip_id else (None, None)
    link = body.link.strip()
    platform = video_import.detect_platform(link)
    job = ImportJob(job_id=new_id("j"), status="pending", platform=platform, link=link)

    if platform == "youtube":
        video_id = video_import.youtube_video_id(link)
        if not video_id:
            raise ApiError(400, "bad_link", "That doesn't look like a YouTube video link.")
        background.add_task(_run_youtube, job.job_id, link, f"youtube:{video_id}", destination, country_code)
    elif platform == "tiktok":
        # Sprint 2: oEmbed caption first, then yt-dlp. Until then, send the user to the paste box.
        job = job.model_copy(update={
            "status": "failed", "error": "unsupported_platform",
            "message": "TikTok import isn't ready yet. Paste the video's caption instead."})
    else:
        raise ApiError(400, "unsupported_platform", "Paste a YouTube or TikTok link.")

    with _lock:
        JOBS[job.job_id] = job
    return job


@router.get("/{job_id}", response_model=ImportJob)
def get_import(job_id: str) -> ImportJob:
    job = JOBS.get(job_id)
    if job is None:
        raise not_found("Import", job_id)
    return job
