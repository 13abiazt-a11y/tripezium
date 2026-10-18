// Talks to C's back end (backend/README.md has the full contract). Every error the API
// returns is { error, message }, and `message` is written to be shown to the user.
import { loadCities } from "./destinations"
import { addDays, daysBetween, suggestCitiesFor } from "./route"
import { loadTrip, saveTrip } from "./trip-store"
import type { Itinerary, ItineraryDay, ItemStatus, Journey, Money, Place, Stay, Trip } from "./types"
import type { EditableItem } from "./voice-edits"

// Inlined at build time (must be written out literally). Defaults to the live API.
const BASE = (process.env.NEXT_PUBLIC_API_URL || "https://api.tripezium.club").replace(/\/$/, "")

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  // JSON by default; for uploads (FormData) the browser must set the multipart header itself.
  const json = !(init?.body instanceof FormData)
  try {
    res = await fetch(BASE + path, { ...init, headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...init?.headers } })
  } catch {
    throw new ApiError(0, "network", "Can't reach the server. Check your connection and try again.")
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = String(body?.message ?? `Something went wrong (${res.status}).`).replace(/^Value error, /, "")
    throw new ApiError(res.status, body?.error ?? "http_error", message)
  }
  return body as T
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
})

// --- Shapes as the API sends them -------------------------------------------------

type ApiLeg = { city: string; country: string; days: number }

type ApiTripIn = {
  destination: string
  route: ApiLeg[]
  startDate: string
  endDate: string
  dayStart: string
  dayEnd: string
  travellers: number
  interests: string[]
  homeCurrency: string
  stays: Stay[]
  transport: Journey[]
}

type ApiPlace = {
  id: string
  name: string
  nameEnglish: string | null
  category: string | null
  lat: number | null
  lng: number | null
  confidence: number | null
  sourceUrl?: string | null
  timestamp?: string | null
  tip?: string | null
}

type ApiItinerary = {
  homeCurrency: string
  tripTotalHome: number
  days: {
    date: string
    city: string | null
    holiday: string | null
    dayTotalHome: number
    items: {
      time: string
      placeId: string
      durationMins: number
      note: string
      estimatedCost: number // per person, local currency
      currency: string
      costHome: number // per person, home currency
      status: ItemStatus
    }[]
  }[]
}

// --- Trip: create once, then send only changes ---------------------------------------

export const isServerTrip = (id: string) => id.startsWith("t_")
const isDemoTrip = (id: string) => id.startsWith("t_demo") // read-only on the server

/**
 * The route as the API wants it: real cities only. A whole-country leg ("explore") is expanded
 * into the same popular cities the itinerary page shows for it.
 */
async function apiRoute(trip: Trip): Promise<ApiLeg[]> {
  const legs: ApiLeg[] = []
  for (const leg of trip.route) {
    if (!leg.explore) {
      legs.push({ city: leg.city, country: leg.country, days: leg.days })
      continue
    }
    for (const part of suggestCitiesFor(leg.country, leg.days)) {
      // No suggested cities for this country: use its most populous city instead of the country's name.
      const city = part.city === leg.city ? ((await loadCities(leg.country))[0] ?? part.city) : part.city
      legs.push({ city, country: leg.country, days: part.days })
    }
  }
  return legs
}

async function payload(trip: Trip): Promise<ApiTripIn> {
  const route = await apiRoute(trip)
  const routeDays = route.reduce((n, r) => n + r.days, 0)
  // The API requires the route's days to add up to the trip. If the user's per-city dates
  // don't match the trip dates, the route wins (the itinerary page shows the same days).
  const endDate = route.length && routeDays !== daysBetween(trip.startDate, trip.endDate)
    ? addDays(trip.startDate, routeDays - 1)
    : trip.endDate
  return {
    destination: trip.destination || route.map((r) => r.city).join(" & ") || "My trip",
    route,
    startDate: trip.startDate,
    endDate,
    dayStart: trip.dayStart,
    dayEnd: trip.dayEnd,
    travellers: trip.travellers,
    interests: trip.interests,
    homeCurrency: trip.budget?.currency || "GBP",
    stays: trip.stays ?? [],
    transport: trip.transport ?? [],
  }
}

/**
 * Make sure the server has this trip as it is now: create it the first time, PATCH it if the
 * user changed anything since. Changing the plan (dates, cities, interests...) makes the server
 * drop the old itinerary, so the itinerary page regenerates. Returns the saved trip.
 */
export function syncTrip(trip: Trip): Promise<Trip> {
  // One sync at a time. Two overlapping first syncs (React runs effects twice in development; a quick
  // double navigation in production) would otherwise both POST and create two trips, and imported
  // places could end up on a different trip from the itinerary. A queued call picks up the id the
  // earlier one saved, so it PATCHes that trip instead of creating another.
  const run = syncQueue.then(() => {
    const stored = loadTrip()
    const fresh = !isServerTrip(trip.id) && isServerTrip(stored.id) ? { ...trip, id: stored.id, synced: stored.synced } : trip
    return syncNow(fresh)
  })
  syncQueue = run.catch(() => undefined)
  return run
}

let syncQueue: Promise<unknown> = Promise.resolve()

async function syncNow(trip: Trip): Promise<Trip> {
  if (isDemoTrip(trip.id)) return trip
  const body = await payload(trip)
  const key = JSON.stringify(body)
  if (isServerTrip(trip.id) && trip.synced === key) return trip

  let id = trip.id
  let saved: ApiTripIn | null = null
  if (isServerTrip(id)) {
    try {
      saved = await request<ApiTripIn>(`/trips/${id}`, send("PATCH", body))
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e
      id = "" // the server doesn't know it any more: start a new one
    }
  }
  if (!isServerTrip(id)) {
    const created = await request<ApiTripIn & { id: string }>("/trips", send("POST", body))
    id = created.id
    saved = created
  }

  // Keep the stays as the server has them: it found their coordinates (for the map and travel times).
  const stays = saved?.stays ?? body.stays
  return saveTrip({ id, synced: JSON.stringify({ ...body, stays }), endDate: body.endDate, stays })
}

/** A trip from the server, in the front end's shape (e.g. to show the demo trip). */
export async function getTrip(id: string): Promise<Trip> {
  const t = await request<ApiTripIn & { id: string }>(`/trips/${id}`)
  return {
    id: t.id,
    destination: t.destination,
    stops: [],
    datesPerCity: false,
    route: t.route.map((r, i) => ({ cityId: `leg-${i}`, city: r.city, country: r.country, days: r.days })),
    startDate: t.startDate,
    endDate: t.endDate,
    dayStart: t.dayStart,
    dayEnd: t.dayEnd,
    travellers: t.travellers,
    interests: t.interests,
    budget: { amount: null, currency: t.homeCurrency },
    stays: t.stays ?? [],
    transport: t.transport ?? [],
  }
}

export const DEMO_TRIP_ID = "t_demo0001"

// --- Places and itinerary ------------------------------------------------------------

function toPlace(p: ApiPlace): Place {
  return {
    id: p.id,
    name: p.name,
    nameEnglish: p.nameEnglish || p.name,
    category: p.category ?? "",
    lat: p.lat,
    lng: p.lng,
    confidence: p.confidence,
    sourceUrl: p.sourceUrl ?? undefined,
    timestamp: p.timestamp ?? undefined,
    tip: p.tip ?? undefined,
  }
}

function toItinerary(it: ApiItinerary): Itinerary {
  const home = it.homeCurrency
  const days: ItineraryDay[] = it.days.map((d) => ({
    date: d.date,
    city: d.city,
    holiday: d.holiday,
    total: { amount: d.dayTotalHome, currency: home },
    items: d.items.map((i) => ({
      time: i.time,
      placeId: i.placeId,
      durationMins: i.durationMins,
      note: i.note || undefined,
      cost: { amount: i.costHome, currency: home },
      localCost: { amount: i.estimatedCost, currency: i.currency },
      status: i.status,
    })),
  }))
  return { days, total: { amount: it.tripTotalHome, currency: home } }
}

export async function getPlaces(tripId: string): Promise<Place[]> {
  const { places } = await request<{ places: ApiPlace[] }>(`/trips/${tripId}/places`)
  return places.map(toPlace)
}

/** The stored itinerary, or null if there isn't one yet. Fast: no AI involved. */
export async function getItinerary(tripId: string): Promise<Itinerary | null> {
  try {
    return toItinerary(await request<ApiItinerary>(`/trips/${tripId}/itinerary`))
  } catch (e) {
    if (e instanceof ApiError && e.code === "no_itinerary") return null
    throw e
  }
}

/** Plan the trip with Gemini. Slow (roughly 25-60 s): show a loading state. */
export async function generateItinerary(tripId: string): Promise<Itinerary> {
  return toItinerary(await request<ApiItinerary>(`/trips/${tripId}/itinerary`, send("POST")))
}

// --- Checking edited days ------------------------------------------------------------

export type CheckedDay = {
  date: string
  city: string | null
  country: string | null
  holiday: string | null
  items: EditableItem[]
  total: Money | null // per person, home currency; null if a stop couldn't be priced
  problems: string[] // e.g. "teamLab Planets isn't open at 08:00 (…)"
}

type ApiCheckedItem = {
  time: string
  name: string
  localName?: string | null
  category?: string | null
  durationMins: number
  note?: string | null
  tip?: string | null
  lat?: number | null
  lng?: number | null
  status: ItemStatus
  localCost?: Money | null
  cost?: Money | null
}

/**
 * Days a voice or typed edit changed: the server checks travel time, opening hours, holidays and
 * costs, and saves them into the plan (`saved`; never for the read-only demo trip).
 */
export async function checkDays(
  tripId: string,
  days: { date: string; city: string; country: string; items: EditableItem[] }[],
): Promise<{ saved: boolean; days: CheckedDay[] }> {
  const body = {
    days: days.map((d) => ({
      date: d.date,
      city: d.city || null,
      country: /^[A-Z]{2}$/.test(d.country) ? d.country : null,
      items: d.items.map((i) => ({
        time: i.time,
        name: i.name,
        localName: i.localName ?? null,
        category: i.category || null,
        durationMins: i.durationMins,
        note: i.note ?? null,
        tip: i.tip ?? null,
        lat: i.lat ?? null,
        lng: i.lng ?? null,
        status: i.status ?? null,
        // A new stop has only the assistant's estimate in the trip currency: the server converts it.
        localCost: i.localCost ?? i.cost ?? null,
      })),
    })),
  }
  const out = await request<{ saved: boolean; days: (Omit<CheckedDay, "items"> & { items: ApiCheckedItem[] })[] }>(
    `/trips/${tripId}/itinerary/check`,
    send("POST", body),
  )
  return {
    saved: out.saved,
    days: out.days.map((d) => ({
      ...d,
      items: d.items.map((i) => ({
        time: i.time,
        name: i.name,
        ...(i.localName ? { localName: i.localName } : {}),
        category: i.category || "activity",
        durationMins: i.durationMins,
        ...(i.note ? { note: i.note } : {}),
        ...(i.tip ? { tip: i.tip } : {}),
        ...(i.lat != null && i.lng != null ? { lat: i.lat, lng: i.lng } : {}),
        status: i.status,
        ...(i.cost ? { cost: i.cost } : {}),
        ...(i.localCost ? { localCost: i.localCost } : {}),
      })),
    })),
  }
}

// --- Imports (D's endpoints): link / caption / screenshots -> background job -> places --------

type ApiImportJob = {
  jobId: string
  status: "pending" | "running" | "done" | "failed"
  platform: string // youtube | tiktok | text | screenshot
  places: ApiPlace[]
  error?: string | null
  message?: string | null // safe to show (also set on some finished jobs, e.g. TikTok slideshows)
}

export type ImportResult = { places: Place[]; message: string | null }

export function startLinkImport(link: string, tripId: string) {
  return request<ApiImportJob>("/imports", send("POST", { link, tripId }))
}

export function startTextImport(text: string, tripId: string) {
  return request<ApiImportJob>("/imports/text", send("POST", { text, tripId }))
}

export function startScreenshotImport(files: File[], tripId: string) {
  const form = new FormData()
  for (const f of files) form.append("files", f)
  form.append("tripId", tripId)
  return request<ApiImportJob>("/imports/images", { method: "POST", body: form })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll a job every 2 s until it finishes. Videos can take a minute or two. */
export async function waitForImport(job: ApiImportJob, timeoutMs = 4 * 60_000): Promise<ImportResult> {
  const until = Date.now() + timeoutMs
  let misses = 0
  while (job.status === "pending" || job.status === "running") {
    if (Date.now() > until) throw new ApiError(504, "import_timeout", "That's taking too long. Try pasting the caption instead.")
    await sleep(2000)
    try {
      job = await request<ApiImportJob>(`/imports/${job.jobId}`)
      misses = 0
    } catch (e) {
      // A dropped request (phone signal, a blip on the server) shouldn't throw away a minute of work:
      // keep polling. Give up on a 404 (the server restarted and forgot the job) or after ~10 s of errors.
      if ((e instanceof ApiError && e.status === 404) || ++misses >= 5) {
        throw new ApiError(503, "import_lost", "We lost track of that import. Please try again: it'll be quicker the second time.")
      }
    }
  }
  if (job.status === "failed") {
    throw new ApiError(422, job.error ?? "import_failed", job.message ?? "We couldn't read that. Try pasting the caption instead.")
  }
  return { places: job.places.map(toPlace), message: job.message ?? null }
}

/** Places the user imported (not the stops Gemini added): those come with a confidence score. */
export async function getImportedPlaces(tripId: string): Promise<Place[]> {
  return (await getPlaces(tripId)).filter((p) => p.confidence !== null || !!p.sourceUrl)
}

/** Save the places the user ticked. The server then treats the old itinerary as out of date. */
export async function savePlaces(tripId: string, places: Place[]): Promise<Place[]> {
  const body = {
    places: places.map((p) => ({
      id: p.id,
      name: p.name,
      nameEnglish: p.nameEnglish,
      category: p.category || null,
      lat: p.lat,
      lng: p.lng,
      confidence: p.confidence,
      sourceUrl: p.sourceUrl ?? null,
      timestamp: p.timestamp ?? null,
      tip: p.tip ?? null,
    })),
  }
  const { places: saved } = await request<{ places: ApiPlace[] }>(`/trips/${tripId}/places`, send("POST", body))
  return saved.map(toPlace)
}
