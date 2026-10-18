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


LOCAL_DATETIME = r"^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$"  # "2026-12-30T09:30", local time where it happens
MAX_BOOKINGS = 30


class Stay(CamelModel):
    """Where the traveller is staying (optional). Coordinates are looked up from the name/address if missing."""
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(None, max_length=300)
    city: str | None = Field(None, max_length=100)
    check_in: dt.date
    check_out: dt.date
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)

    @model_validator(mode="after")
    def _order(self):
        if self.check_out < self.check_in:
            raise ValueError("checkOut must be on or after checkIn")
        return self


class Journey(CamelModel):
    """A flight, train, bus... the traveller has booked (optional): the way in, the way home, or between cities."""
    kind: Literal["flight", "train", "bus", "ferry", "car", "other"] = "flight"
    origin: str = Field(min_length=1, max_length=120)       # "London Heathrow", "Tokyo Station"
    destination: str = Field(min_length=1, max_length=120)
    departs: str = Field(pattern=LOCAL_DATETIME)
    arrives: str | None = Field(None, pattern=LOCAL_DATETIME)
    reference: str | None = Field(None, max_length=40)       # "BA7", "Nozomi 21"

    @model_validator(mode="after")
    def _order(self):
        if self.arrives and self.arrives < self.departs:  # same format, so strings compare correctly
            raise ValueError("arrives must be after departs")
        return self


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
    stays: list[Stay] = Field(default_factory=list, max_length=MAX_BOOKINGS)
    transport: list[Journey] = Field(default_factory=list, max_length=MAX_BOOKINGS)

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


class TripUpdate(CamelModel):
    """PATCH /trips/{id}: send only the fields that changed. The merged trip is validated exactly
    like a new one (dates, route days adding up, real cities). To clear the route, send "route": []."""
    destination: str | None = Field(None, min_length=1, max_length=200)
    route: list[RouteLeg] | None = Field(None, max_length=MAX_ROUTE_LEGS)
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    day_start: str | None = Field(None, pattern=HHMM)
    day_end: str | None = Field(None, pattern=HHMM)
    travellers: int | None = Field(None, ge=1, le=50)
    interests: list[str] | None = Field(None, max_length=20)
    home_currency: str | None = Field(None, pattern=CURRENCY)
    stays: list[Stay] | None = Field(None, max_length=MAX_BOOKINGS)  # send [] to clear
    transport: list[Journey] | None = Field(None, max_length=MAX_BOOKINGS)


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
    # Getting here from the previous stop (estimated from coordinates); null for a day's first stop
    # or when a place has no coordinates. travelMode: walk | transit | train.
    travel_mins: int | None = None
    travel_mode: Literal["walk", "transit", "train"] | None = None
    travel_km: float | None = None


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


# --- Checking edited days (voice / typed changes on the itinerary page) ---

class Money(CamelModel):
    amount: float = Field(ge=0)
    currency: str = Field(pattern=CURRENCY)


class EditItemIn(CamelModel):
    """A stop as the itinerary page edits it: place details inline, so the assistant can add new places."""
    time: str = Field(pattern=HHMM)
    name: str = Field(min_length=1, max_length=300)
    local_name: str | None = Field(None, max_length=300)
    category: str | None = Field(None, max_length=50)
    duration_mins: int = Field(ge=0, le=24 * 60)
    note: str | None = Field(None, max_length=500)
    tip: str | None = Field(None, max_length=500)
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    status: Status | None = None  # the previous check, if the stop was already in the plan
    local_cost: Money | None = None  # per person, as already estimated
    estimated_cost: float | None = Field(None, ge=0)  # per person in the day's local currency (new stops)


class EditDayIn(CamelModel):
    date: dt.date
    city: str | None = Field(None, max_length=100)
    country: str | None = Field(None, pattern=r"^[A-Z]{2}$")
    items: list[EditItemIn] = Field(max_length=25)


class PlanCheckIn(CamelModel):
    days: list[EditDayIn] = Field(min_length=1, max_length=MAX_TRIP_DAYS)


class EditItemOut(EditItemIn):
    status: Status
    cost: Money | None = None  # per person, home currency; null if we couldn't price it
    travel_mins: int | None = None
    travel_mode: Literal["walk", "transit", "train"] | None = None
    travel_km: float | None = None


class EditDayOut(CamelModel):
    date: dt.date
    city: str | None = None
    country: str | None = None
    holiday: str | None = None
    items: list[EditItemOut]
    total: Money | None = None  # per person, home currency
    problems: list[str] = Field(default_factory=list)  # e.g. "Ends at 22:30, after your day ends at 21:00"


class PlanCheckOut(CamelModel):
    saved: bool  # false for read-only trips (the demo): checked, but only kept in the browser
    days: list[EditDayOut]


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
