// Turns the picked countries/cities into a travel route with a recommended
// number of days per city. Pure functions, no React.
import { countryName, isBigCity } from "./destinations"
import type { CountryStop, RouteStop, Trip } from "./types"

const DAY = 86_400_000

const toUTC = (d: string) => Date.parse(d + "T00:00:00Z")

/** Inclusive day count: 1 Dec → 3 Dec = 3 days. */
export function daysBetween(start: string, end: string) {
  if (!start || !end) return 0
  return Math.max(0, Math.round((toUTC(end) - toUTC(start)) / DAY) + 1)
}

export function addDays(date: string, n: number) {
  return new Date(toUTC(date) + n * DAY).toISOString().slice(0, 10)
}

export function newId() {
  return Math.random().toString(36).slice(2, 10)
}

/** "Paris" · "Paris & Lyon" · "France & Italy" · "France, Italy & Spain" */
export function summarise(stops: CountryStop[]) {
  const filled = stops.filter((s) => s.cities.length)
  const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} & ${xs.at(-1)}`)
  if (filled.length === 1) {
    const cities = filled[0].cities.map((c) => c.name)
    return cities.length <= 2 ? list(cities) : countryName(filled[0].country)
  }
  return list(filled.map((s) => countryName(s.country)))
}

/**
 * Split `total` days across cities by weight (big cities get a bit more),
 * at least 1 day each, using largest-remainder rounding so the sum is exact.
 */
function split(total: number, weights: number[]) {
  const n = weights.length
  if (!n) return []
  if (total <= n) return weights.map(() => 1)
  const sum = weights.reduce((a, b) => a + b, 0)
  const spare = total - n // everyone gets 1, share the rest
  const raw = weights.map((w) => (spare * w) / sum)
  const out = raw.map((r) => 1 + Math.floor(r))
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), weights[i], i] as const).sort((a, b) => b[0] - a[0] || b[1] - a[1])
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k][2]]++
  return out
}

/** Recommended route: grouped by country in the order picked, dated cities sorted by date. */
export function recommendRoute(trip: Pick<Trip, "stops" | "startDate" | "endDate" | "datesPerCity">): RouteStop[] {
  const legs = trip.stops.flatMap((s) =>
    s.cities.map((c) => ({ city: c, country: s.country })),
  )
  const total = daysBetween(trip.startDate, trip.endDate)

  const fixed = new Map<string, number>()
  if (trip.datesPerCity) {
    for (const { city } of legs) {
      const d = daysBetween(city.startDate ?? "", city.endDate ?? "")
      if (d) fixed.set(city.id, d)
    }
  }
  const usedByFixed = [...fixed.values()].reduce((a, b) => a + b, 0)
  const flexible = legs.filter((l) => !fixed.has(l.city.id))
  const shares = split(
    Math.max(flexible.length, total - usedByFixed),
    flexible.map((l) => (isBigCity(l.country, l.city.name) ? 1.5 : 1)),
  )
  const flexDays = new Map(flexible.map((l, i) => [l.city.id, shares[i]]))

  const route = legs.map((l) => ({
    cityId: l.city.id,
    city: l.city.name,
    country: l.country,
    days: fixed.get(l.city.id) ?? flexDays.get(l.city.id) ?? 1,
  }))

  if (trip.datesPerCity) {
    const start = new Map(legs.map((l) => [l.city.id, l.city.startDate || "9999"]))
    route.sort((a, b) => start.get(a.cityId)!.localeCompare(start.get(b.cityId)!))
  }
  return route
}

/**
 * Keep the user's route edits if they didn't change which cities are in the trip
 * or the dates; otherwise recommend afresh.
 */
export function syncRoute(trip: Trip, previous: Trip): RouteStop[] {
  const ids = (r: RouteStop[]) => r.map((x) => x.cityId).sort().join()
  const cityIds = trip.stops.flatMap((s) => s.cities.map((c) => c.id)).sort().join()
  const sameShape =
    previous.route.length > 0 &&
    ids(previous.route) === cityIds &&
    previous.startDate === trip.startDate &&
    previous.endDate === trip.endDate &&
    previous.datesPerCity === trip.datesPerCity &&
    !trip.datesPerCity
  return sameShape ? previous.route : recommendRoute(trip)
}

export type PlannedDay = { date: string; city: string; country: string; dayInCity: number; daysInCity: number }

/** Expand the route into dated days, starting from the trip start date. */
export function planDays(startDate: string, route: RouteStop[]): PlannedDay[] {
  const out: PlannedDay[] = []
  let i = 0
  for (const leg of route) {
    for (let d = 0; d < leg.days; d++) {
      out.push({ date: addDays(startDate, i++), city: leg.city, country: leg.country, dayInCity: d + 1, daysInCity: leg.days })
    }
  }
  return out
}
