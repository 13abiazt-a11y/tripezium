"use client"

// Map pins for one day: the activities' own coordinates when they're near the
// city, otherwise looked up by name (Gemini + OpenStreetMap, via lib/geo.ts).
import type { MapStop } from "@/components/trip-map"
import { cityKey, distanceKm, useCityCoords, type LatLng } from "./geo"
import type { EditableDay, EditableItem } from "./voice-edits"

export function useDayStops(day: EditableDay | undefined, centre: LatLng | null | undefined): MapStop[] {
  const items = day?.items ?? []
  const placed = (it: EditableItem) =>
    it.lat !== undefined && it.lng !== undefined && (!centre || distanceKm(centre, { lat: it.lat, lng: it.lng }) <= 120)
  const unplaced = day ? items.filter((it) => !placed(it) && it.name !== "Unknown place") : []
  const found = useCityCoords(unplaced.map((it) => ({ city: day!.city, country: day!.country, place: it.name })))
  return items.flatMap((it, i) => {
    const at = placed(it) ? { lat: it.lat!, lng: it.lng! } : found[cityKey(day!.city, day!.country, it.name)]
    return at ? [{ n: i + 1, name: it.name, category: it.category, lat: at.lat, lng: at.lng }] : []
  })
}
