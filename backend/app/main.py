import logging

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import check_db
from .errors import install_error_handlers
from .routers import imports, itinerary, places, trips

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="IKU Trip Planner API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

install_error_handlers(app)

app.include_router(trips.router)
app.include_router(places.router)
app.include_router(itinerary.router)
app.include_router(imports.router)


@app.get("/health")
def health(response: Response) -> dict:
    db = check_db()
    if db != "ok":
        response.status_code = 503
    return {"status": "ok" if db == "ok" else "degraded", "db": db}
