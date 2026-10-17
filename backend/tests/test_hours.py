import datetime as dt

import pytest

from app.services import hours
from app.services.planner import final_status

# Google format: day 0 = Sunday. A museum open Tue-Sun 09:30-17:00, closed Mondays.
MUSEUM = {
    "periods": [{"open": {"day": d, "hour": 9, "minute": 30}, "close": {"day": d, "hour": 17, "minute": 0}}
                for d in (0, 2, 3, 4, 5, 6)],
    "weekdayDescriptions": ["Monday: Closed", "Tuesday: 9:30 AM – 5:00 PM", "Wednesday: 9:30 AM – 5:00 PM",
                            "Thursday: 9:30 AM – 5:00 PM", "Friday: 9:30 AM – 5:00 PM",
                            "Saturday: 9:30 AM – 5:00 PM", "Sunday: 9:30 AM – 5:00 PM"],
}
# A bar open Sat 18:00 -> Sun 02:00 (wraps past the end of the week).
BAR = {"periods": [{"open": {"day": 6, "hour": 18, "minute": 0}, "close": {"day": 0, "hour": 2, "minute": 0}}]}
ALWAYS = {"periods": [{"open": {"day": 0, "hour": 0, "minute": 0}}]}

MON = dt.date(2027, 1, 4)
TUE = dt.date(2027, 1, 5)
SAT = dt.date(2027, 1, 2)


@pytest.mark.parametrize("date, start, mins, expected", [
    (TUE, "10:00", 120, True),    # inside hours
    (MON, "10:00", 120, False),   # closed Mondays
    (TUE, "09:00", 60, False),    # before opening
    (TUE, "16:00", 90, False),    # runs past closing
    (TUE, "15:30", 90, True),     # finishes exactly at closing
])
def test_museum(date, start, mins, expected):
    assert hours.is_open_for_visit(hours.parse_hours(MUSEUM), date, start, mins) is expected


def test_overnight_bar_wrapping_the_week():
    h = hours.parse_hours(BAR)
    assert hours.is_open_for_visit(h, SAT, "22:00", 180)       # Sat 22:00 -> Sun 01:00
    assert not hours.is_open_for_visit(h, SAT, "17:00", 60)    # before opening


def test_open_24_7():
    assert hours.is_open_for_visit(hours.parse_hours(ALWAYS), MON, "03:00", 60)


def test_no_hours_data():
    assert hours.parse_hours(None) is None
    assert hours.parse_hours({"weekdayDescriptions": []}) is None


def test_describe_day_uses_monday_first_descriptions():
    assert hours.describe_day(hours.parse_hours(MUSEUM), MON) == "Monday: Closed"


@pytest.mark.parametrize("gemini_status, verdict, expected", [
    ("ok", "closed", "closed"),           # hours say closed: trust the data
    ("ok", "open", "ok"),
    ("check_hours", "open", "check_hours"),  # weekly hours can't see seasonal closures: never upgrade
    ("closed", "open", "closed"),
    ("ok", "unknown", "check_hours"),     # no hours on Google: don't claim it's open
    ("check_hours", "unknown", "check_hours"),
    ("ok", None, "ok"),                   # check off (no key): Gemini's judgement stands
    ("check_hours", None, "check_hours"),
])
def test_final_status(gemini_status, verdict, expected):
    assert final_status(gemini_status, verdict) == expected


def test_open_air_places_without_hours_stay_ok():
    assert final_status("ok", "unknown", "landmark") == "ok"      # e.g. Shibuya Crossing
    assert final_status("ok", "unknown", "Park") == "ok"
    assert final_status("ok", "unknown", "market") == "check_hours"
    assert final_status("ok", "closed", "park") == "closed"       # real closures still count


def test_field_mask_is_hours_only():
    assert hours.FIELD_MASK == "places.regularOpeningHours"
