"""Budget maths: pure functions, Decimal throughout, floats only when serialising.

Gemini estimates local costs per person; this code does ALL conversion and totals.
"""
from decimal import ROUND_HALF_UP, Decimal

from ..schemas import Itinerary

PENNY = Decimal("0.01")


def to_decimal(x) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))  # str() avoids float artefacts


def cost_home(estimated_cost, rate: Decimal | None) -> Decimal:
    """estimatedCost (local) * rate (local -> home), rounded half-up to 2 dp. No rate -> 0."""
    if rate is None:
        return Decimal("0.00")
    return (to_decimal(estimated_cost or 0) * rate).quantize(PENNY, ROUND_HALF_UP)


def apply_budget(itinerary: Itinerary, rates: dict[str, Decimal | None]) -> Itinerary:
    """Fill costHome per item, dayTotalHome per day and tripTotalHome.

    `rates` maps item currency -> rate into the itinerary's home currency.
    Totals are sums of the already-rounded item values, so what the user sees always adds up.
    """
    trip_total = Decimal(0)
    for day in itinerary.days:
        day_total = Decimal(0)
        for item in day.items:
            c = cost_home(item.estimated_cost, rates.get(item.currency))
            item.cost_home = float(c)
            day_total += c
        day.day_total_home = float(day_total)
        trip_total += day_total
    itinerary.trip_total_home = float(trip_total)
    return itinerary
