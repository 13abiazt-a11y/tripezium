# Back end

FastAPI service that stores trips and places, generates a day-by-day itinerary with Gemini,
flags public-holiday closures, and costs every item in local and home currency.

> **Status: M2.** Trips and places are stored in Tiger Data (Postgres + TimescaleDB).
> The itinerary endpoints still return the Tokyo mock until Gemini generation lands (M3).

## Run locally

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows (Git Bash); macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in DATABASE_URL (Tiger Data connection string) at minimum
python apply_schema.py        # creates tables + the fx_rates hypertable (safe to re-run)
python seed_demo.py           # creates/resets the demo trip t_demo0001
uvicorn app.main:app --reload --port 8000
```

Interactive docs: http://localhost:8000/docs

Tests: `python -m pytest -q` (API tests run against the DB in `DATABASE_URL` and clean up after themselves; they're skipped if it isn't set)

The password in `DATABASE_URL` can contain special characters like `@`; the app percent-encodes it.

## Endpoints

| Method + path | Notes |
|---|---|
| `GET /health` | `{ "status": "ok", "db": "ok" }`, or 503 with `"status": "degraded"` if the DB is unreachable |
| `POST /trips` | Body: Trip without `id`. Returns 201 + full Trip. Resolves country + currency via Nominatim |
| `GET /trips/{id}` | Returns Trip |
| `POST /trips/{id}/places` | Body `{ "places": [Place] }`. Missing `id`s are assigned. Returns `{ "places": [Place] }` |
| `POST /trips/{id}/itinerary` | Generates and stores the itinerary |
| `GET /trips/{id}/itinerary` | Returns the stored itinerary |
| `POST /imports` | Body `{ "link", "tripId"? }` (YouTube or TikTok, short links OK). Returns 202 + ImportJob `{ jobId, status, platform, link, places, error, message }` |
| `POST /imports/text` | Paste-a-caption fallback. Body `{ "text", "tripId"?, "sourceUrl"? }`. Returns 202 + ImportJob |
| `POST /imports/images` | Screenshots. Multipart form: `files` (1 to 10 JPEG/PNG/WebP/HEIC, 10 MB each) + optional `tripId`. Returns 202 + ImportJob |
| `GET /imports/{jobId}` | Poll until `status` is `done` (places ready) or `failed` (show `message`, offer screenshots / paste box) |

**Import:** everything goes through Gemini (needs `GEMINI_API_KEY`; `GEMINI_MODEL` defaults to
`gemini-3.8-flash`), then places are geocoded with Nominatim using the trip's destination.
- **YouTube:** the URL goes straight to Gemini, which watches the video.
- **TikTok:** no downloading. The caption and cover image come from TikTok's public oEmbed endpoint.
  Photo slideshows only expose the first slide, so a `done` job carries a `message` asking for screenshots.
- **Text / screenshots:** all screenshots are read together in one call, so a whole slideshow works.
- `failed` with `error: "no_places"` means nothing was found; `message` says what to try next.

Results are cached per video / post / text / set of images, so a repeat import is quick.
Try it without the server: `python -m app.services.video_import "<youtube-url>" Tokyo`

**Demo trip ID:** `t_demo0001` (Tokyo, 30 Dec 2026 to 2 Jan 2027, 2 travellers, GBP).

All JSON is camelCase. Errors are always `{ "error": "<code>", "message": "<text>" }`.
`estimatedCost` and `costHome` are **per person**.

## Credits

FastAPI, Uvicorn, Pydantic, pydantic-settings, SQLAlchemy, psycopg, httpx, Tiger Data / TimescaleDB,
Nominatim / OpenStreetMap (geocoding). (Full list added as the build progresses.)
