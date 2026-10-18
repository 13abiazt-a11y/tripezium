// Travel time between consecutive stops. Same estimate as the back end (backend/app/services/travel.py),
// computed here too so it stays right after voice edits reorder or swap stops in the browser.
// Keep the constants in sync with the back end.

const DETOUR = 1.3 // streets aren't straight lines
const WALK_KMH = 4.5
const WALK_MAX_KM = 1.5
const WALK_MAX_MINS = 25
const TRANSIT_OVERHEAD = 10 // walk to the station + wait
const TRANSIT_KMH = 25
const TRAIN_FROM_KM = 40
const TRAIN_OVERHEAD = 20
const TRAIN_KMH = 80
const STEP = 5

export type TravelMode = "walk" | "transit" | "train"
export type Leg = { mode: TravelMode; mins: number; km: number }
type Point = { lat?: number | null; lng?: number | null }

const roundUp = (mins: number) => Math.max(STEP, Math.ceil(mins / STEP) * STEP)

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = (d: number) => (d * Math.PI) / 180
  const dp = rad(bLat - aLat)
  const dl = rad(bLng - aLng)
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dl / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

/** Getting from a to b, or null if either has no coordinates. */
export function estimateLeg(a: Point, b: Point): Leg | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
  const km = distanceKm(a.lat, a.lng, b.lat, b.lng) * DETOUR
  const walk = (km / WALK_KMH) * 60
  const rounded = Math.round(km * 10) / 10
  if (km <= WALK_MAX_KM) return { mode: "walk", mins: roundUp(walk), km: rounded }
  if (km <= TRAIN_FROM_KM) {
    const transit = TRANSIT_OVERHEAD + (km / TRANSIT_KMH) * 60
    if (walk <= WALK_MAX_MINS && walk <= transit) return { mode: "walk", mins: roundUp(walk), km: rounded }
    return { mode: "transit", mins: roundUp(transit), km: rounded }
  }
  return { mode: "train", mins: roundUp(TRAIN_OVERHEAD + (km / TRAIN_KMH) * 60), km: rounded }
}

const toMins = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

/** Minutes between the end of the previous stop and the start of this one. */
export function gapMins(prev: { time: string; durationMins: number }, next: { time: string }) {
  return toMins(next.time) - (toMins(prev.time) + prev.durationMins)
}

export function describeLeg(leg: Leg) {
  if (leg.mode === "walk") return `${leg.mins} min walk · ${leg.km} km`
  if (leg.mode === "train") return `~${leg.mins} min by train · ${Math.round(leg.km)} km`
  return `~${leg.mins} min by public transport · ${leg.km} km`
}
