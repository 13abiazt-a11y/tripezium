import datetime as dt
from decimal import Decimal

from app.schemas import Itinerary, ItineraryDay, ItineraryItem
from app.services.budget import apply_budget, cost_home


def test_same_currency_is_unchanged():
    assert cost_home(12.5, Decimal(1)) == Decimal("12.50")


def test_conversion():
    assert cost_home(2000, Decimal("0.0052")) == Decimal("10.40")   # the contract's example


def test_rounding_is_half_up_to_the_penny():
    assert cost_home(1, Decimal("0.005")) == Decimal("0.01")        # 0.005 -> 0.01, not banker's 0.00
    assert cost_home(1, Decimal("0.0049")) == Decimal("0.00")
    assert cost_home(1500, Decimal("0.004745")) == Decimal("7.12")  # 7.1175 -> 7.12


def test_zero_and_missing_cost():
    assert cost_home(0, Decimal("0.0052")) == Decimal("0.00")
    assert cost_home(None, Decimal("0.0052")) == Decimal("0.00")


def test_no_rate_gives_zero_not_a_crash():
    assert cost_home(1000, None) == Decimal("0.00")


def test_no_float_artefacts():
    # 0.1 + 0.2 != 0.3 in floats; Decimal from str() avoids it
    assert cost_home(0.1, Decimal(1)) + cost_home(0.2, Decimal(1)) == Decimal("0.30")


def _item(cost, currency="JPY"):
    return ItineraryItem(time="10:00", place_id="p", duration_mins=60, note="", estimated_cost=cost,
                         currency=currency, cost_home=0, status="ok")


def test_totals_add_up_from_rounded_items():
    it = Itinerary(home_currency="GBP", trip_total_home=0, days=[
        ItineraryDay(date=dt.date(2026, 12, 30), day_total_home=0, items=[_item(1500), _item(1500), _item(1500)]),
        ItineraryDay(date=dt.date(2026, 12, 31), day_total_home=0, items=[_item(0), _item(12, "EUR")]),
    ])
    apply_budget(it, {"JPY": Decimal("0.004745"), "EUR": Decimal("0.844")})
    d1, d2 = it.days
    assert [i.cost_home for i in d1.items] == [7.12, 7.12, 7.12]
    assert d1.day_total_home == 21.36            # sum of rounded items (not round(3 * 7.1175) = 21.35)
    assert [i.cost_home for i in d2.items] == [0.0, 10.13]
    assert d2.day_total_home == 10.13
    assert it.trip_total_home == 31.49
    assert Decimal(str(it.trip_total_home)) == sum(Decimal(str(d.day_total_home)) for d in it.days)
