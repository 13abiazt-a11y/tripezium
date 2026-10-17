"""Public holidays from Nager.Date, cached in the `holidays` table, plus the closure check.

The closure check is deterministic code, not AI: it runs after Gemini and can only make
statuses more cautious (ok -> check_hours), never less.
"""
import datetime as dt
import logging
import time
from dataclasses import dataclass

import httpx
from sqlalchemy import and_, exists, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..models import HolidayRow
from ..schemas import Itinerary

log = logging.getLogger("app.holidays")

NAGER_URL = "https://date.nager.at/api/v3/PublicHolidays/{year}/{country}"

CLOSURE_PRONE = {"museum", "shop", "shopping", "market", "restaurant", "cafe", "bank", "office", "gallery"}


@dataclass(frozen=True)
class Holiday:
    date: dt.date
    name: str


def _fetch_year(country: str, year: int) -> list[Holiday] | None:
    t0 = time.perf_counter()
    try:
        r = httpx.get(NAGER_URL.format(year=year, country=country), timeout=5.0)
        r.raise_for_status()
        out = [
            Holiday(dt.date.fromisoformat(h["date"]), h["name"])
            for h in r.json()
            if h.get("global", True) and "Public" in (h.get("types") or ["Public"])  # national public holidays only
        ]
        log.info("nager ok %s %d: %d holidays %.0fms", country, year, len(out), (time.perf_counter() - t0) * 1000)
        return out
    except Exception as e:
        log.warning("nager failed %s %d: %s %.0fms", country, year, e, (time.perf_counter() - t0) * 1000)
        return None


def _year_cached(db: Session, country: str, year: int) -> bool:
    return db.scalar(select(exists().where(and_(
        HolidayRow.country_code == country,
        HolidayRow.date.between(dt.date(year, 1, 1), dt.date(year, 12, 31)),
    ))))


def get_holidays(db: Session, country: str | None, start: dt.date, end: dt.date) -> list[Holiday]:
    """Holidays within [start, end]. Fetches every year the trip touches. Never raises."""
    if not country:
        return []
    try:
        for year in range(start.year, end.year + 1):
            if _year_cached(db, country, year):
                continue
            fetched = _fetch_year(country, year)
            if fetched:
                stmt = pg_insert(HolidayRow).values(
                    [{"country_code": country, "date": h.date, "name": h.name} for h in fetched]
                ).on_conflict_do_nothing()  # two holidays on one date: keep the first
                db.execute(stmt)
                db.commit()
        rows = db.scalars(select(HolidayRow).where(
            HolidayRow.country_code == country, HolidayRow.date.between(start, end)
        ).order_by(HolidayRow.date))
        return [Holiday(r.date, r.name) for r in rows]
    except Exception as e:
        db.rollback()
        log.warning("holiday lookup failed %s: %s", country, e)
        return []


def apply_closure_check(itinerary: Itinerary, holidays: list[Holiday], categories: dict[str, str | None]) -> Itinerary:
    """Set each day's `holiday`, and on holidays downgrade closure-prone 'ok' items to 'check_hours'.

    `categories` maps placeId -> category. 'closed' is never changed.
    """
    by_date = {h.date: h.name for h in holidays}
    for day in itinerary.days:
        day.holiday = by_date.get(day.date)
        if day.holiday is None:
            continue
        for item in day.items:
            if item.status == "ok" and (categories.get(item.place_id) or "").lower() in CLOSURE_PRONE:
                item.status = "check_hours"
    return itinerary
