"""Import places from a link, pasted text or screenshots. Every route starts a background job;
GET /imports/{jobId} polls it.

Jobs live in memory. Gemini and geocoding results are cached in Tiger Data (services/import_cache).
"""
import hashlib
import logging
import threading
from collections.abc import Callable

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile

from ..db import _session_factory
from ..errors import ApiError, not_found
from ..ids import new_id
from ..schemas import ImportCreate, ImportJob, ImportTextCreate, Place, PlaceIn
from ..services import import_cache, video_import
from .trips import get_trip_or_404

log = logging.getLogger("app.imports")

router = APIRouter(prefix="/imports", tags=["imports"])

JOBS: dict[str, ImportJob] = {}
_lock = threading.Lock()

MAX_IMAGES = 10
MAX_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}

SLIDESHOW_MESSAGE = ("This TikTok is a photo slideshow, so we could only read its caption and first slide. "
                     "Upload screenshots of the other slides to get the rest.")
NO_PLACES_MESSAGE = {
    "text": "We couldn't find any places in that text. Try screenshots of the post instead.",
    "screenshot": "We couldn't find any places in those screenshots. Try pasting the caption instead.",
}
NO_PLACES_DEFAULT = "We couldn't find any places in that. Try screenshots, or paste the caption instead."

# prepare() -> (cache key, extract function, message to show with the finished job)
Prepare = Callable[[], tuple[str, Callable[[], list[PlaceIn]], str | None]]


def _with_ids(places: list[PlaceIn]) -> list[Place]:
    # Fresh ids per job, so the review screen can key checkboxes and POST /trips/{id}/places upserts.
    return [Place(**{**p.model_dump(), "id": new_id("p")}) for p in places]


def _update(job_id: str, **changes) -> None:
    with _lock:
        JOBS[job_id] = JOBS[job_id].model_copy(update=changes)


def _run(job_id: str, prepare: Prepare, destination: str | None, country_code: str | None) -> None:
    _update(job_id, status="running")
    try:
        cache_key, extract, message = prepare()  # may hit the network (e.g. TikTok short links)
        places = import_cache.get_places(cache_key)
        if places is None:
            places = extract()
            import_cache.put_places(cache_key, places)  # raw Gemini output; geocoding is cached per query
        places = video_import.geocode_places(places, destination, country_code)
    except ApiError as exc:
        _update(job_id, status="failed", error=exc.code, message=exc.message)
        return
    except Exception:
        log.exception("import job %s crashed", job_id)
        _update(job_id, status="failed", error="internal_error",
                message="Something went wrong. Try screenshots, or paste the caption instead.")
        return
    if not places:
        _update(job_id, status="failed", error="no_places",
                message=NO_PLACES_MESSAGE.get(JOBS[job_id].platform, NO_PLACES_DEFAULT))
        return
    _update(job_id, status="done", places=_with_ids(places), message=message)


def _trip_context(trip_id: str | None) -> tuple[str | None, str | None]:
    """(destination, country code) for the trip. Only touches the DB when a tripId is sent."""
    if not trip_id:
        return None, None
    with _session_factory()() as db:
        trip = get_trip_or_404(db, trip_id)
        return trip.destination, trip.country_code


def _start(background: BackgroundTasks, platform: str, link: str | None, prepare: Prepare,
           trip: tuple[str | None, str | None]) -> ImportJob:
    job = ImportJob(job_id=new_id("j"), status="pending", platform=platform, link=link)
    with _lock:
        JOBS[job.job_id] = job
    background.add_task(_run, job.job_id, prepare, *trip)
    return job


def _sha(*chunks: bytes) -> str:
    h = hashlib.sha256()
    for c in chunks:
        h.update(hashlib.sha256(c).digest())  # hash of hashes, so chunk boundaries count
    return h.hexdigest()[:32]


@router.post("", response_model=ImportJob, status_code=202)
def create_import(body: ImportCreate, background: BackgroundTasks) -> ImportJob:
    link = body.link.strip()
    platform = video_import.detect_platform(link)
    trip = _trip_context(body.trip_id)  # 404s an unknown trip before any job starts

    if platform == "youtube":
        video_id = video_import.youtube_video_id(link)
        if not video_id:
            raise ApiError(400, "bad_link", "That doesn't look like a YouTube video link.")

        def prepare():
            return f"youtube:{video_id}", lambda: video_import.extract_places_from_youtube(link, trip[0]), None
    elif platform == "tiktok":
        def prepare():
            url, post_id, is_slideshow = video_import.resolve_tiktok(link)
            return (f"tiktok:{post_id}", lambda: video_import.extract_places_from_tiktok(url, trip[0]),
                    SLIDESHOW_MESSAGE if is_slideshow else None)
    else:
        raise ApiError(400, "unsupported_platform", "Paste a YouTube or TikTok link.")

    return _start(background, platform, link, prepare, trip)


@router.post("/text", response_model=ImportJob, status_code=202)
def create_text_import(body: ImportTextCreate, background: BackgroundTasks) -> ImportJob:
    """Paste-a-caption fallback: any text that mentions places."""
    text = body.text.strip()
    if not text:
        raise ApiError(400, "empty_text", "Paste a caption or some text that mentions places.")
    trip = _trip_context(body.trip_id)
    destination = trip[0]
    key = f"text:{_sha(text.encode(), (destination or '').encode())}"
    return _start(background, "text", body.source_url,
                  lambda: (key, lambda: video_import.extract_places_from_text(text, destination, body.source_url), None),
                  trip)


@router.post("/images", response_model=ImportJob, status_code=202)
def create_image_import(background: BackgroundTasks,
                        files: list[UploadFile] = File(..., description=f"1 to {MAX_IMAGES} screenshots"),
                        trip_id: str | None = Form(None, alias="tripId")) -> ImportJob:
    """Screenshots (e.g. every slide of a TikTok slideshow). Multipart form: files[] + optional tripId."""
    if not 1 <= len(files) <= MAX_IMAGES:
        raise ApiError(400, "bad_images", f"Upload between 1 and {MAX_IMAGES} screenshots.")
    images = []
    for f in files:
        mime = (f.content_type or "").split(";")[0].lower()
        if mime not in IMAGE_TYPES:
            raise ApiError(400, "bad_images", f"'{f.filename}' isn't a JPEG, PNG, WebP or HEIC image.")
        data = f.file.read(MAX_IMAGE_BYTES + 1)
        if len(data) > MAX_IMAGE_BYTES:
            raise ApiError(400, "bad_images", f"'{f.filename}' is over {MAX_IMAGE_BYTES // (1024 * 1024)} MB.")
        if not data:
            raise ApiError(400, "bad_images", f"'{f.filename}' is empty.")
        images.append((data, mime))

    trip = _trip_context(trip_id)
    destination = trip[0]
    key = f"images:{_sha(*(d for d, _ in images), (destination or '').encode())}"
    return _start(background, "screenshot", None,
                  lambda: (key, lambda: video_import.extract_places_from_images(images, destination), None),
                  trip)


@router.get("/{job_id}", response_model=ImportJob)
def get_import(job_id: str) -> ImportJob:
    job = JOBS.get(job_id)
    if job is None:
        raise not_found("Import", job_id)
    return job
