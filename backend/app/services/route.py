"""Which city each day of a trip is in.

A trip either has a `route` (multi-city: legs in travel order, each with a number of days) or
just a `destination` (one place for the whole trip). Everything that needs "where is the
traveller on this date" goes through here, so a single-destination trip is just a one-leg route.
"""
import datetime as dt
from dataclasses import dataclass

from ..models import TripRow


@dataclass(frozen=True)
class Leg:
    city: str
    country: str | None  # ISO alpha-2
    currency: str | None  # ISO 4217
    days: int


def trip_days(trip: TripRow) -> int:
    return (trip.end_date - trip.start_date).days + 1


def legs(trip: TripRow) -> list[Leg]:
    if trip.route:
        return [Leg(r["city"], r.get("country"), r.get("currency"), int(r["days"])) for r in trip.route]
    return [Leg(trip.destination, trip.country_code, trip.local_currency, trip_days(trip))]


def day_legs(trip: TripRow) -> list[tuple[dt.date, Leg]]:
    """One (date, leg) per trip day, in order. If the legs fall short, the last leg runs on."""
    all_legs = legs(trip)
    per_day = [leg for leg in all_legs for _ in range(leg.days)]
    n = trip_days(trip)
    per_day = (per_day + [all_legs[-1]] * n)[:n]
    return [(trip.start_date + dt.timedelta(days=i), leg) for i, leg in enumerate(per_day)]


def is_multi_city(trip: TripRow) -> bool:
    return len(legs(trip)) > 1


def cities(trip: TripRow) -> list[str]:
    """Distinct cities in travel order."""
    return list(dict.fromkeys(leg.city for leg in legs(trip)))


def single_country(trip: TripRow) -> str | None:
    """The trip's country if every leg is in the same one, else None."""
    countries = {leg.country for leg in legs(trip)}
    return countries.pop() if len(countries) == 1 else None


def describe(names: list[str]) -> str:
    """["Paris"] -> "Paris"; ["Paris", "Lyon", "Rome"] -> "Paris, Lyon and Rome"."""
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"
