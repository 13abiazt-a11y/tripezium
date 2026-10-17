# Back end

FastAPI service that stores trips and places, generates a day-by-day itinerary with Gemini,
flags public-holiday closures, and costs every item in local and home currency.

> **Status: M1, mock mode.** Every endpoint returns contract-shaped JSON for a hardcoded Tokyo
> trip. Trips and places are held in memory and vanish on restart. The database comes in M2.

## Run locally

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows (Git Bash); macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in values (none are needed for M1)
uvicorn app.main:app --reload --port 8000
```

Interactive docs: http://localhost:8000/docs

Tests: `python -m pytest -q`

## Endpoints

| Method + path | Notes |
|---|---|
| `GET /health` | `{ "status": "ok", ... }` |
| `POST /trips` | Body: Trip without `id`. Returns 201 + full Trip |
| `GET /trips/{id}` | Returns Trip |
| `POST /trips/{id}/places` | Body `{ "places": [Place] }`. Missing `id`s are assigned. Returns `{ "places": [Place] }` |
| `POST /trips/{id}/itinerary` | Generates and stores the itinerary |
| `GET /trips/{id}/itinerary` | Returns the stored itinerary |
| `POST /imports` | Body `{ "link", "tripId"? }`. Returns 202 + ImportJob `{ jobId, status, platform, link, places, error, message }` |
| `GET /imports/{jobId}` | Poll until `status` is `done` (places ready) or `failed` (show `message`, open the paste box) |

**Video import:** YouTube links go straight to Gemini (needs `GEMINI_API_KEY`; `GEMINI_MODEL`
defaults to `gemini-2.5-flash`). Results are cached per video, so a repeat import returns
`done` immediately. TikTok returns `failed` / `unsupported_platform` until Sprint 2.
Try it without the server: `python -m app.services.video_import "<youtube-url>" Tokyo`

**Demo trip ID (mock):** `t_demo0001` (Tokyo, 30 Dec 2026 to 2 Jan 2027, 2 travellers, GBP).

All JSON is camelCase. Errors are always `{ "error": "<code>", "message": "<text>" }`.
`estimatedCost` and `costHome` are **per person**.

## Credits

FastAPI, Uvicorn, Pydantic, pydantic-settings. (Full list added as the build progresses.)
