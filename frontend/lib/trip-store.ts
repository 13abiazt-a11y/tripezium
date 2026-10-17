// Keeps the trip being planned in the browser between pages.
// Later, C's API (POST /trips) becomes the source of truth and this just caches the id.
import type { Trip } from "./types"

const KEY = "trip-draft"

export const emptyTrip: Trip = {
  id: "draft",
  destination: "",
  stops: [],
  datesPerCity: false,
  route: [],
  startDate: "",
  endDate: "",
  dayStart: "09:00",
  dayEnd: "21:00",
  travellers: 1,
  interests: [],
}

export function loadTrip(): Trip {
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? JSON.parse(raw) : {}
    const trip: Trip = { ...emptyTrip, ...saved }
    // Drafts saved before the multi-city picker existed have no stops/route.
    if (!Array.isArray(trip.stops)) trip.stops = []
    if (!Array.isArray(trip.route)) trip.route = []
    return trip
  } catch {
    return emptyTrip
  }
}

export function saveTrip(patch: Partial<Trip>): Trip {
  const next = { ...loadTrip(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage blocked (private mode) — app still works for this page
  }
  return next
}
