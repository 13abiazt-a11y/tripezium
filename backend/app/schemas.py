"""Pydantic models = the API contract (section 3 of the spec).

Python uses snake_case; JSON is camelCase via the alias generator.
FastAPI serialises response models by alias, so the front end only ever sees camelCase.
"""
import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
CURRENCY = r"^[A-Z]{3}$"
MAX_TRIP_DAYS = 30

Status = Literal["ok", "check_hours", "closed"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- Trip ---------------------------------------------------------------

MAX_ROUTE_LEGS = 15


class RouteLeg(CamelModel):
    """One city on a multi-city trip, in travel order (the front end's RouteStop)."""
    city: str = Field(min_length=1, max_length=100)
    country: str = Field(pattern=r"^[A-Z]{2}$")  # ISO 3166-1 alpha-2, e.g. "FR"
    days: int = Field(ge=1, le=MAX_TRIP_DAYS)


class TripCreate(CamelModel):
    destination: str = Field(min_length=1, max_length=200)  # display summary, e.g. "France & Italy"
    # Optional. Empty = a single-destination trip (the original contract). When given, the legs'
    # days must add up to the trip's length; the itinerary then plans each day in that day's city.
    route: list[RouteLeg] = Field(default_factory=list, max_length=MAX_ROUTE_LEGS)
    start_date: dt.date
    end_date: dt.date
    day_start: str = Field("09:00", pattern=HHMM)
    day_end: str = Field("21:00", pattern=HHMM)
    travellers: int = Field(1, ge=1, le=50)
    interests: list[str] = Field(default_factory=list, max_length=20)
    home_currency: str = Field("GBP", pattern=CURRENCY)

    @model_validator(mode="after")
    def _check_ranges(self):
        if self.end_date < self.start_date:
            raise ValueError("endDate must be on or after startDate")
        if (self.end_date - self.start_date).days + 1 > MAX_TRIP_DAYS:
            raise ValueError(f"trips are limited to {MAX_TRIP_DAYS} days")
        if self.day_end <= self.day_start:  # "HH:MM" strings compare correctly
            raise ValueError("dayEnd must be after dayStart")
        trip_days = (self.end_date - self.start_date).days + 1
        if self.route and sum(leg.days for leg in self.route) != trip_days:
            raise ValueError(f"route days add up to {sum(leg.days for leg in self.route)}, "
                             f"but the trip is {trip_days} days")
        return self


class Trip(TripCreate):
    id: str


# --- Place --------------------------------------------------------------

class PlaceIn(CamelModel):
    """A place as sent by the front end. `id` is optional; we assign one if missing."""
    id: str | None = None
    name: str = Field(min_length=1, max_length=300)
    name_english: str | None = None
    category: str | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    confidence: float | None = Field(None, ge=0, le=1)
    source_url: str | None = None
    timestamp: str | None = None
    tip: str | None = None
    # Importer-internal geocoding hints (e.g. "Asakusa", "Tokyo"). Never serialised, not in the contract.
    area: str | None = Field(None, exclude=True)
    city: str | None = Field(None, exclude=True)


class Place(PlaceIn):
    id: str


class PlacesIn(CamelModel):
    places: list[PlaceIn] = Field(max_length=100)


class PlacesOut(CamelModel):
    places: list[Place]


# --- Itinerary ----------------------------------------------------------

class ItineraryItem(CamelModel):
    time: str = Field(pattern=HHMM)
    place_id: str
    duration_mins: int = Field(ge=0)
    note: str = ""
    estimated_cost: float = Field(ge=0)  # per person, local currency
    currency: str = Field(pattern=CURRENCY)
    cost_home: float  # per person, home currency
    status: Status


class ItineraryDay(CamelModel):
    date: dt.date
    city: str | None = None  # the route leg this day belongs to (multi-city trips)
    holiday: str | None = None
    items: list[ItineraryItem]
    day_total_home: float


class Itinerary(CamelModel):
    days: list[ItineraryDay]
    trip_total_home: float
    home_currency: str = Field(pattern=CURRENCY)


# --- Imports ------------------------------------------------------------

ImportStatus = Literal["pending", "running", "done", "failed"]


class ImportCreate(CamelModel):
    link: str = Field(min_length=1, max_length=2000)
    trip_id: str | None = None  # gives Gemini the destination as context


class ImportTextCreate(CamelModel):
    text: str = Field(min_length=1, max_length=10_000)
    trip_id: str | None = None
    source_url: str | None = Field(None, max_length=2000)  # where the text came from, if known


class ImportJob(CamelModel):
    job_id: str
    status: ImportStatus
    platform: str  # youtube | tiktok | text | screenshot
    link: str | None = None
    places: list[Place] = Field(default_factory=list)
    error: str | None = None  # error code when status == "failed"
    message: str | None = None  # human-readable, safe to show the user (also set on some "done" jobs)


# --- Misc ---------------------------------------------------------------

class ErrorOut(BaseModel):
    error: str
    message: str
