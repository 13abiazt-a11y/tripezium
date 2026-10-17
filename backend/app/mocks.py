"""M1 mock data: a hardcoded Tokyo demo trip so the front end can build against the contract.

Replaced by the database (M2) and Gemini (M3). Trips/places created via the mock
endpoints live in memory only and vanish on restart.
"""
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

from .schemas import Itinerary, ItineraryDay, ItineraryItem, Place, Trip

DEMO_TRIP_ID = "t_demo0001"

DEMO_TRIP = Trip(
    id=DEMO_TRIP_ID,
    destination="Tokyo",
    start_date=dt.date(2026, 12, 30),
    end_date=dt.date(2027, 1, 2),
    day_start="09:00",
    day_end="21:00",
    travellers=2,
    interests=["food", "temples", "nightlife"],
    home_currency="GBP",
)

_VIDEO = "https://www.tiktok.com/@example/video/0000000000"


def _p(id_, name, category, lat, lng, *, english=None, imported=False, ts=None, tip=None):
    return Place(
        id=id_, name=name, name_english=english or name, category=category,
        lat=lat, lng=lng, confidence=0.9 if imported else None,
        source_url=_VIDEO if imported else None, timestamp=ts, tip=tip,
    )


DEMO_PLACES = [
    _p("p_sensoji1", "浅草寺", "temple", 35.7148, 139.7967, english="Senso-ji", imported=True, ts="02:14", tip="Go early"),
    _p("p_nakamise", "仲見世通り", "shopping", 35.7119, 139.7964, english="Nakamise-dori"),
    _p("p_daikokuy", "大黒家天麩羅", "restaurant", 35.7126, 139.7953, english="Daikokuya Tempura", imported=True, ts="00:41"),
    _p("p_skytree1", "東京スカイツリー", "viewpoint", 35.7101, 139.8107, english="Tokyo Skytree"),
    _p("p_omoideyk", "思い出横丁", "nightlife", 35.6929, 139.6995, english="Omoide Yokocho", imported=True, ts="05:02", tip="Cash only at most stalls"),
    _p("p_tnmuseum", "東京国立博物館", "museum", 35.7188, 139.7765, english="Tokyo National Museum"),
    _p("p_ameyoko1", "アメ横", "market", 35.7101, 139.7745, english="Ameyoko"),
    _p("p_teamlab1", "チームラボプラネッツ", "museum", 35.6491, 139.7898, english="teamLab Planets", imported=True, ts="01:30", tip="Book ahead"),
    _p("p_matsuya1", "神田まつや", "restaurant", 35.6957, 139.7700, english="Kanda Matsuya"),
    _p("p_meijijg1", "明治神宮", "temple", 35.6764, 139.6993, english="Meiji Jingu"),
    _p("p_tsukiji1", "築地場外市場", "market", 35.6654, 139.7707, english="Tsukiji Outer Market", imported=True, ts="03:12"),
    _p("p_shibsky1", "渋谷スカイ", "viewpoint", 35.6585, 139.7022, english="Shibuya Sky"),
    _p("p_ebisuyk1", "恵比寿横丁", "restaurant", 35.6472, 139.7110, english="Ebisu Yokocho"),
    _p("p_imperial", "皇居", "landmark", 35.6852, 139.7528, english="Imperial Palace"),
    _p("p_ginza001", "銀座", "shopping", 35.6717, 139.7650, english="Ginza"),
    _p("p_goldengi", "ゴールデン街", "nightlife", 35.6940, 139.7046, english="Golden Gai"),
]

# Approximate mock rate; M5 replaces this with fx.py.
_JPY_TO_GBP = Decimal("0.0052")
_PENNY = Decimal("0.01")

# (date, holiday, [(time, placeId, durationMins, note, estimatedCostJPY, status), ...])
_DAYS = [
    (dt.date(2026, 12, 30), None, [
        ("09:00", "p_sensoji1", 90, "Start here before the crowds arrive", 0, "ok"),
        ("10:45", "p_nakamise", 60, "Snacks and souvenirs on the way out", 1500, "ok"),
        ("12:00", "p_daikokuy", 60, "Tempura lunch", 2000, "ok"),
        ("14:00", "p_skytree1", 120, "Year-end hours may differ", 3100, "check_hours"),
        ("18:30", "p_omoideyk", 120, "Yakitori alleys", 4000, "ok"),
    ]),
    (dt.date(2026, 12, 31), None, [
        ("09:30", "p_tnmuseum", 120, "Closed 26 Dec to 1 Jan; shown for the 'closed' badge", 1000, "closed"),
        ("12:00", "p_ameyoko1", 90, "New Year's Eve market rush", 2000, "ok"),
        ("15:00", "p_teamlab1", 120, "Book a timed ticket", 3800, "ok"),
        ("19:00", "p_matsuya1", 60, "Toshikoshi soba, the New Year's Eve tradition", 1500, "ok"),
    ]),
    (dt.date(2027, 1, 1), "New Year's Day", [
        ("09:00", "p_meijijg1", 120, "Hatsumode: the first shrine visit of the year. Expect big crowds.", 0, "ok"),
        ("12:00", "p_tsukiji1", 90, "Many stalls close over New Year", 3000, "check_hours"),
        ("15:00", "p_shibsky1", 90, "Holiday hours may differ", 2500, "check_hours"),
        ("18:30", "p_ebisuyk1", 120, "Some bars close on 1 Jan", 5000, "check_hours"),
    ]),
    (dt.date(2027, 1, 2), None, [
        ("09:30", "p_imperial", 120, "Emperor's New Year greeting, only held on 2 Jan", 0, "ok"),
        ("13:00", "p_ginza001", 150, "Hatsuuri New Year sales", 5000, "ok"),
        ("18:00", "p_goldengi", 150, "Tiny bars, some with cover charges", 4500, "ok"),
    ]),
]


def demo_itinerary() -> Itinerary:
    days = []
    for date, holiday, rows in _DAYS:
        items = []
        for time, place_id, mins, note, cost, status in rows:
            cost_home = (Decimal(cost) * _JPY_TO_GBP).quantize(_PENNY, ROUND_HALF_UP)
            items.append(ItineraryItem(
                time=time, place_id=place_id, duration_mins=mins, note=note,
                estimated_cost=cost, currency="JPY", cost_home=float(cost_home), status=status,
            ))
        day_total = sum((Decimal(str(i.cost_home)) for i in items), Decimal(0))
        days.append(ItineraryDay(date=date, holiday=holiday, items=items, day_total_home=float(day_total)))
    trip_total = sum((Decimal(str(d.day_total_home)) for d in days), Decimal(0))
    return Itinerary(days=days, trip_total_home=float(trip_total), home_currency="GBP")


# In-memory stores for the mock endpoints.
TRIPS: dict[str, Trip] = {DEMO_TRIP_ID: DEMO_TRIP}
PLACES: dict[str, dict[str, Place]] = {DEMO_TRIP_ID: {p.id: p for p in DEMO_PLACES}}
