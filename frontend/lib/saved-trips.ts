"use client"

// Finished plans the user saved to their home page ("My trips"). Each one is a
// snapshot (trip, itinerary, places, voice changes), so it opens instantly and
// stays as it was saved. Kept in this browser (localStorage).
import { PALETTE, tripColour } from "@/components/trip-stamp"
import type { Itinerary, Place, Trip } from "./types"
import type { Overrides } from "./voice-edits"

export type SavedTrip = {
  id: string // the server trip id
  savedAt: string // ISO time
  trip: Trip
  itinerary: Itinerary
  places: Place[]
  overrides: Overrides
  colour?: string // stamp colour on the home page, chosen once so it never changes
}

/** A colour none of the other saved trips uses (falls back to the trip's own if all are taken). */
function freeColour(id: string, others: SavedTrip[]) {
  const used = new Set(others.map((t) => t.colour))
  const own = tripColour(id)
  if (!used.has(own)) return own
  return PALETTE.find((c) => !used.has(c)) ?? own
}

/** Give trips saved before colours existed their own distinct colour (oldest first), once. */
export function withColours(list: SavedTrip[]): SavedTrip[] {
  if (list.every((t) => t.colour)) return list
  const done: SavedTrip[] = []
  for (const t of [...list].sort((a, b) => a.savedAt.localeCompare(b.savedAt))) {
    done.push(t.colour ? t : { ...t, colour: freeColour(t.id, done) })
  }
  const byId = new Map(done.map((t) => [t.id, t]))
  const next = list.map((t) => byId.get(t.id)!)
  write(next)
  return next
}

const KEY = "saved-trips"

export function listSaved(): SavedTrip[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    return Array.isArray(list) ? list.filter((t) => t && t.id && t.trip && t.itinerary) : []
  } catch {
    return []
  }
}

export function getSaved(id: string): SavedTrip | null {
  return listSaved().find((t) => t.id === id) ?? null
}

function write(list: SavedTrip[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false // storage full or blocked
  }
}

/** Save (or update) a trip; newest first. Returns false if the browser wouldn't store it. */
export function saveToMyTrips(entry: Omit<SavedTrip, "savedAt">): boolean {
  const all = listSaved()
  const rest = all.filter((t) => t.id !== entry.id)
  const colour = all.find((t) => t.id === entry.id)?.colour ?? freeColour(entry.id, rest)
  return write([{ ...entry, colour, savedAt: new Date().toISOString() }, ...rest])
}

export function deleteSaved(id: string) {
  write(listSaved().filter((t) => t.id !== id))
}
