import datetime as dt

import pytest
from sqlalchemy import delete

from app.db import _session_factory
from app.models import HolidayRow
from app.schemas import Itinerary, ItineraryDay, ItineraryItem
from app.services import holidays as hol
from app.services.holidays import Holiday, apply_closure_check
from tests.test_api import needs_db

NEW_YEAR = Holiday(dt.date(2027, 1, 1), "New Year's Day")


def item(place_id, status="ok"):
    return ItineraryItem(time="10:00", place_id=place_id, duration_mins=60, note="", estimated_cost=0,
                         currency="JPY", cost_home=0, status=status)


def itinerary():
    return Itinerary(home_currency="GBP", trip_total_home=0, days=[
        ItineraryDay(date=dt.date(2026, 12, 31), items=[item("museum1")], day_total_home=0),
        ItineraryDay(date=dt.date(2027, 1, 1), day_total_home=0, items=[
            item("museum1"), item("shrine1"), item("market1", "closed"), item("cafe1", "check_hours"), item("mystery"),
        ]),
    ])


CATS = {"museum1": "museum", "shrine1": "shrine", "market1": "market", "cafe1": "Cafe", "mystery": None}


def test_new_years_day_in_japan_flags_risky_items():
    out = apply_closure_check(itinerary(), [NEW_YEAR], CATS)
    eve, nyd = out.days
    assert eve.holiday is None and eve.items[0].status == "ok"   # not a holiday: untouched
    assert nyd.holiday == "New Year's Day"
    statuses = {i.place_id: i.status for i in nyd.items}
    assert statuses == {
        "museum1": "check_hours",   # closure-prone: downgraded
        "shrine1": "ok",            # not closure-prone
        "market1": "closed",        # never un-closed
        "cafe1": "check_hours",     # category match is case-insensitive
        "mystery": "ok",            # unknown category: left alone
    }


def test_no_holidays_changes_nothing():
    out = apply_closure_check(itinerary(), [], CATS)
    assert all(d.holiday is None for d in out.days)
    assert [i.status for i in out.days[1].items] == ["ok", "ok", "closed", "check_hours", "ok"]


@pytest.fixture
def fake_country():
    yield "XX"
    with _session_factory()() as db:
        db.execute(delete(HolidayRow).where(HolidayRow.country_code == "XX"))
        db.commit()


@needs_db
def test_trip_over_new_year_fetches_both_years_and_caches(monkeypatch, fake_country):
    calls = []
    def fake_fetch(country, year):
        calls.append(year)
        return [Holiday(dt.date(year, 1, 1), "New Year's Day"), Holiday(dt.date(year, 12, 25), "Christmas")]
    monkeypatch.setattr(hol, "_fetch_year", fake_fetch)

    with _session_factory()() as db:
        got = hol.get_holidays(db, fake_country, dt.date(2026, 12, 20), dt.date(2027, 1, 2))
        assert calls == [2026, 2027]
        assert [(h.date.isoformat(), h.name) for h in got] == [("2026-12-25", "Christmas"), ("2027-01-01", "New Year's Day")]

        hol.get_holidays(db, fake_country, dt.date(2026, 12, 20), dt.date(2027, 1, 2))
        assert calls == [2026, 2027]  # second time: served from the DB cache, no API calls


@needs_db
def test_api_failure_returns_empty_list(monkeypatch, fake_country):
    monkeypatch.setattr(hol, "_fetch_year", lambda c, y: None)
    with _session_factory()() as db:
        assert hol.get_holidays(db, fake_country, dt.date(2027, 5, 1), dt.date(2027, 5, 3)) == []


def test_no_country_returns_empty_list():
    assert hol.get_holidays(None, None, dt.date(2027, 1, 1), dt.date(2027, 1, 2)) == []
