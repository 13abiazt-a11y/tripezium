// Voice / typed changes to the itinerary ("swap the museum on day 2 for a food tour").
// The changed days are kept in this browser (localStorage), per trip, on top of
// the planned itinerary. When C's itinerary endpoint is live, send the same
// changes there instead.
import type { ItemStatus, Money } from "./types"

/** One activity, with the place details inline so the assistant can invent new ones. */
export type EditableItem = {
  time: string // HH:mm
  name: string
  localName?: string // name in the local language, when different
  category: string
  durationMins: number
  note?: string
  tip?: string
  cost?: Money // per person, home currency
  localCost?: Money // the same in the local currency
  estimatedCost?: number // a new stop's price per person in the local currency, from the assistant (until checked)
  status?: ItemStatus // opening-hours check from the API
  lat?: number // where it is, when known (for the map)
  lng?: number
}

export type EditableDay = {
  day: number // 1-based
  date: string // YYYY-MM-DD
  city: string
  country: string // ISO alpha-2
  items: EditableItem[]
}

/** A day the assistant changed. `baseCity` is the city the route planned for that date. */
export type DayOverride = {
  date: string
  baseCity: string
  city: string
  country: string
  items: EditableItem[]
}

export type Overrides = Record<string, DayOverride> // by date

export type DayChange = { day: number; city: string; country: string; items: EditableItem[] }

/** What /api/voice-edit returns. */
export type VoiceEditResult = {
  transcript: string
  intent: "edit" | "answer" | "read"
  reply: string
  changes: DayChange[]
}

const key = (tripKey: string) => `voice-edits:${tripKey}`

export function loadOverrides(tripKey: string): Overrides {
  try {
    const raw = localStorage.getItem(key(tripKey))
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function saveOverrides(tripKey: string, overrides: Overrides) {
  try {
    if (Object.keys(overrides).length) localStorage.setItem(key(tripKey), JSON.stringify(overrides))
    else localStorage.removeItem(key(tripKey))
  } catch {
    // storage blocked (private mode): edits last until the page is closed
  }
}

/**
 * Put the assistant's changed days on top of the planned days. An edit is
 * dropped if the route has since put a different city on that date.
 */
export function applyOverrides(days: EditableDay[], overrides: Overrides) {
  const edited = new Set<string>()
  const out = days.map((d) => {
    const o = overrides[d.date]
    if (!o || o.baseCity !== d.city) return d
    edited.add(d.date)
    return { ...d, city: o.city || d.city, country: o.country || d.country, items: o.items }
  })
  return { days: out, edited }
}

/** Merge new changes from the assistant into the stored overrides. */
export function mergeChanges(base: EditableDay[], overrides: Overrides, changes: DayChange[]): Overrides {
  const next = { ...overrides }
  for (const c of changes) {
    const d = base[c.day - 1]
    if (!d) continue
    next[d.date] = { date: d.date, baseCity: d.city, city: c.city || d.city, country: c.country || d.country, items: c.items }
  }
  return next
}
