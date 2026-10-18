"""SQLAlchemy tables. Must match schema.sql (which is the source of truth for the DB)."""
import datetime as dt
from typing import Any

from sqlalchemy import (
    Column, Date, DateTime, Float, ForeignKey, Integer, MetaData, Table, Text, Time, func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    metadata = MetaData()


class TripRow(Base):
    __tablename__ = "trips"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    destination: Mapped[str] = mapped_column(Text)
    country_code: Mapped[str | None] = mapped_column(Text)
    local_currency: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[dt.date] = mapped_column(Date)
    end_date: Mapped[dt.date] = mapped_column(Date)
    day_start: Mapped[dt.time] = mapped_column(Time)
    day_end: Mapped[dt.time] = mapped_column(Time)
    travellers: Mapped[int] = mapped_column(Integer, default=1)
    interests: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    home_currency: Mapped[str] = mapped_column(Text, default="GBP")
    # [{"city", "country", "days", "currency"}] in travel order; [] = single destination
    route: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    # The traveller's own bookings, both optional (see schemas.Stay / schemas.Journey)
    stays: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    transport: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PlaceRow(Base):
    __tablename__ = "places"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    trip_id: Mapped[str] = mapped_column(Text, ForeignKey("trips.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text)
    name_english: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)
    source_url: Mapped[str | None] = mapped_column(Text)
    ts: Mapped[str | None] = mapped_column(Text)
    tip: Mapped[str | None] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(Text, default="import")


class ItineraryRow(Base):
    __tablename__ = "itineraries"

    trip_id: Mapped[str] = mapped_column(Text, ForeignKey("trips.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class HolidayRow(Base):
    __tablename__ = "holidays"

    country_code: Mapped[str] = mapped_column(Text, primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    name: Mapped[str] = mapped_column(Text)


# The hypertable has no primary key, so it's a plain Core table rather than an ORM class.
fx_rates = Table(
    "fx_rates", Base.metadata,
    Column("time", DateTime(timezone=True), nullable=False),
    Column("base", Text, nullable=False),
    Column("quote", Text, nullable=False),
    Column("rate", Float, nullable=False),
    Column("source", Text, nullable=False),
)


class ImportCacheRow(Base):
    __tablename__ = "import_cache"

    cache_key: Mapped[str] = mapped_column(Text, primary_key=True)
    places: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GeocodeCacheRow(Base):
    __tablename__ = "geocode_cache"

    query: Mapped[str] = mapped_column(Text, primary_key=True)
    country_code: Mapped[str] = mapped_column(Text, primary_key=True, default="")
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
