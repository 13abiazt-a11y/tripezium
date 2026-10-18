// Turns the API's itinerary into the days the itinerary and final-plan pages show
// (with voice changes on top). Shared so both pages always show the same plan.
import type { MapCity } from "@/components/trip-map"
import { planDays } from "./route"
import type { Itinerary, ItineraryItem, Money, Place, Trip } from "./types"
import { applyOverrides, type EditableDay, type EditableItem, type Overrides } from "./voice-edits"

export type ShownDay = {
  date: string
  city: string
  country: string
  dayInCity?: number
  daysInCity?: number
  explore?: boolean
  holiday?: string | null
  total?: Money
  items: ItineraryItem[]
}

/** API items + their places → items with the place details inline (what voice edits and the map use). */
export function toEditable(items: ItineraryItem[], places: Map<string, Place>): EditableItem[] {
  return items.map((i) => {
    const p = places.get(i.placeId)
    return {
      time: i.time,
      name: p?.nameEnglish ?? "Unknown place",
      ...(p && p.name !== p.nameEnglish ? { localName: p.name } : {}),
      category: p?.category ?? "activity",
      durationMins: i.durationMins,
      ...(i.note ? { note: i.note } : {}),
      ...(p?.tip ? { tip: p.tip } : {}),
      ...(i.cost ? { cost: i.cost } : {}),
      ...(i.localCost ? { localCost: i.localCost } : {}),
      ...(i.status ? { status: i.status } : {}),
      ...(p && p.lat != null && p.lng != null && (p.lat || p.lng) ? { lat: p.lat, lng: p.lng } : {}),
    }
  })
}

/** The API's days, with the city/day-in-city details from the route. */
export function buildDays(trip: Trip | null, itinerary: Itinerary | null): ShownDay[] {
  const planned = trip ? planDays(trip.startDate, trip.route) : []
  return itinerary
    ? itinerary.days.map((d) => {
        const p = planned.find((x) => x.date === d.date)
        return { ...p, ...d, city: p?.city ?? d.city ?? trip?.destination ?? "", country: p?.country ?? "" }
      })
    : planned.map((p) => ({ ...p, items: [] }))
}

/** Days with voice changes applied. `baseDays` is what voice changes are merged against. */
export function withVoiceChanges(days: ShownDay[], places: Map<string, Place>, overrides: Overrides) {
  const baseDays: EditableDay[] = days.map((d, i) => ({
    day: i + 1,
    date: d.date,
    city: d.city,
    country: d.country,
    items: toEditable(d.items, places),
  }))
  const { days: shown, edited } = applyOverrides(baseDays, overrides)
  return { baseDays, shown, edited }
}

/** Cities in travel order, with how many days in each, for the map's whole-trip view. */
export function citySegments(shown: EditableDay[], activeIndex: number): Omit<MapCity, "at">[] {
  const segments: Omit<MapCity, "at">[] = []
  shown.forEach((d, i) => {
    const last = segments.at(-1)
    if (last && last.city === d.city && last.country === d.country) last.days++
    else segments.push({ city: d.city, country: d.country, days: 1, firstDay: i, active: false })
  })
  segments.forEach((s, i) => {
    const next = segments[i + 1]?.firstDay ?? shown.length
    s.active = activeIndex >= s.firstDay && activeIndex < next
  })
  return segments
}

/**
 * The trip's cost per person after voice changes: the API's day totals for days
 * that weren't changed, and the activities' own prices for days that were.
 * `unpriced` counts changed activities with no price (so totals may be low).
 */
export function planTotals(days: ShownDay[], shown: EditableDay[], edited: Set<string>, itinerary: Itinerary | null) {
  const apiTotal = itinerary?.total
  if (!apiTotal) return { total: null, dayTotals: days.map((d) => d.total ?? null), unpriced: 0 }
  const currency = apiTotal.currency
  let sum = apiTotal.amount
  let unpriced = 0
  const dayTotals: (Money | null)[] = shown.map((d, i) => {
    const api = days[i]?.total ?? null
    if (!edited.has(d.date)) return api
    let amount = 0
    for (const it of d.items) {
      if (it.cost && it.cost.currency === currency) amount += it.cost.amount
      else unpriced++
    }
    sum += amount - (api?.amount ?? 0)
    return { amount: Math.round(amount * 100) / 100, currency }
  })
  return { total: { amount: Math.round(sum * 100) / 100, currency }, dayTotals, unpriced }
}
