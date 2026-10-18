"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  BedDouble,
  CalendarHeart,
  CircleAlert,
  CircleCheck,
  Clock,
  Compass,
  Footprints,
  Lightbulb,
  Loader2,
  Plane,
  RefreshCw,
  TrainFront,
  TramFront,
  Undo2,
  Wallet,
} from "lucide-react"

import { BookingsEditor } from "@/components/bookings-editor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ListenButton } from "@/components/ListenButton"
import { PageShell } from "@/components/page-shell"
import { RouteEditor } from "@/components/route-editor"
import { categoryColour, TripMap, type MapCity, type MapMode, type MapStop } from "@/components/trip-map"
import { VoiceEditButton } from "@/components/VoiceEditButton"
import { checkDays, DEMO_TRIP_ID, generateItinerary, getItinerary, getPlaces, getTrip, syncTrip } from "@/lib/api"
import { describeJourney, journeysOn, kindLabel, stayOn } from "@/lib/bookings"
import { countryName, flagOf } from "@/lib/destinations"
import { SHOW_COSTS } from "@/lib/flags"
import { describeLeg, estimateLeg, gapMins } from "@/lib/travel"
import { cityKey, distanceKm, useCityCoords } from "@/lib/geo"
import { formatMoney } from "@/lib/money"
import { narrateDay } from "@/lib/narration"
import { addDays, daysBetween, planDays, recommendRoute } from "@/lib/route"
import { loadTrip, saveTrip } from "@/lib/trip-store"
import type { Itinerary, ItineraryItem, Money, Place, RouteStop, Stay, Trip } from "@/lib/types"
import {
  applyOverrides,
  loadOverrides,
  mergeChanges,
  saveOverrides,
  type EditableDay,
  type EditableItem,
  type Overrides,
  type VoiceEditResult,
} from "@/lib/voice-edits"

function formatDay(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ")
}

type Phase = "loading" | "generating" | "ready" | "error"

type ShownDay = {
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
function toEditable(items: ItineraryItem[], places: Map<string, Place>): EditableItem[] {
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

function Cost({ item }: { item: EditableItem }) {
  if (!item.cost) return null
  if (item.cost.amount === 0) return <span className="font-medium text-foreground">Free</span>
  const local = item.localCost && item.localCost.currency !== item.cost.currency ? item.localCost : null
  return (
    <span className="font-medium text-foreground">
      ~{formatMoney(item.cost)}
      {local ? <span className="font-normal text-muted-foreground"> · {formatMoney(local)}</span> : null}
    </span>
  )
}

/** How you get here from the previous stop; red if the plan doesn't leave enough time (e.g. after a voice edit). */
function TravelHint({ prev, item, from }: { prev: EditableItem; item: EditableItem; from?: string }) {
  const leg = estimateLeg(prev, item)
  if (!leg) return null
  const gap = gapMins(prev, item)
  const tight = !from && gap < leg.mins
  const Icon = leg.mode === "walk" ? Footprints : leg.mode === "train" ? TrainFront : TramFront
  return (
    <p className={`mb-1.5 flex items-center gap-1.5 text-xs ${tight ? "font-medium text-destructive" : "text-muted-foreground"}`}>
      <Icon className="size-3.5 shrink-0" />
      {from ? `From ${from}: ` : ""}
      {describeLeg(leg)}
      {tight ? ` · only ${Math.max(gap, 0)} min to get here` : ""}
    </p>
  )
}

/** The day's own bookings: where you're staying, and journeys leaving or arriving today. */
function DayBookings({ date, trip }: { date: string; trip: Trip }) {
  const stay = stayOn(date, trip.stays)
  const journeys = journeysOn(date, trip.transport)
  if (!stay && !journeys.length) return null
  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-xl bg-card p-3 text-sm ring-1 ring-foreground/10">
      {journeys.map((j, i) => {
        const Icon = j.kind === "flight" ? Plane : TrainFront
        return (
          <p key={i} className="flex items-start gap-2">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium">
                {kindLabel(j.kind)}
                {j.reference ? ` ${j.reference}` : ""}
              </span>{" "}
              · {describeJourney(j)}
            </span>
          </p>
        )
      })}
      {stay ? (
        <p className="flex items-start gap-2">
          <BedDouble className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            {stay.checkIn === date ? "Check in at " : "Staying at "}
            <span className="font-medium">{stay.name}</span>
            {stay.checkOut === date ? " · check out today" : ""}
          </span>
        </p>
      ) : null}
    </div>
  )
}

/** What the server found when it checked a voice change. */
function CheckNote({ problems, checking }: { problems?: string[]; checking: boolean }) {
  if (checking)
    return (
      <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Checking opening hours, travel time and prices…
      </p>
    )
  if (!problems) return null
  if (!problems.length)
    return (
      <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheck className="size-3.5 text-primary" /> Change checked: open at those times, with time to get between
        stops.
      </p>
    )
  return (
    <div className="mb-3 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
      <p className="mb-1 flex items-center gap-1.5 font-medium">
        <CircleAlert className="size-4 text-destructive" /> We checked your change
      </p>
      <ul className="list-disc pl-5 text-xs">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  )
}

/** The accommodation as a starting point for the day's first stop (needs coordinates). */
function stayStart(stay: Stay | null, dayStart?: string): EditableItem | null {
  if (!stay || stay.lat == null || stay.lng == null) return null
  return { time: dayStart || "09:00", name: stay.name, category: "stay", durationMins: 0, lat: stay.lat, lng: stay.lng }
}

function StatusBadge({ status }: { status?: ItineraryItem["status"] }) {
  if (status === "check_hours") return <Badge variant="outline">Check hours</Badge>
  if (status === "closed") return <Badge variant="destructive">Closed</Badge>
  return null
}

export default function ItineraryPage() {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [places, setPlaces] = useState<Map<string, Place>>(new Map())
  const [phase, setPhase] = useState<Phase>("loading")
  const [error, setError] = useState("")
  const [routeChanged, setRouteChanged] = useState(false)
  const [active, setActive] = useState(0)
  const [overrides, setOverrides] = useState<Overrides>({})
  const [mapMode, setMapMode] = useState<MapMode>("day")
  const [selectedStop, setSelectedStop] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkNotes, setCheckNotes] = useState<Record<string, string[]>>({}) // by date, after a voice change
  const started = useRef(false) // dev Strict Mode runs effects twice: never ask Gemini twice

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : "Something went wrong. Please try again.")
    setPhase("error")
  }

  // The stored itinerary if there is one (instant), otherwise ask Gemini to plan it (slow).
  const loadItinerary = useCallback(async (tripId: string) => {
    let it = await getItinerary(tripId)
    if (!it) {
      setPhase("generating")
      it = await generateItinerary(tripId)
    }
    const list = await getPlaces(tripId) // after generating: includes the stops Gemini added
    setPlaces(new Map(list.map((p) => [p.id, p])))
    setItinerary(it)
    setOverrides(loadOverrides(tripId)) // voice changes made in this browser
    setPhase("ready")
  }, [])

  const run = useCallback(async () => {
    setError("")
    setPhase("loading")
    try {
      let t = loadTrip()
      if (t.stops.length && t.startDate) {
        if (!t.route.length) t = saveTrip({ route: recommendRoute(t) })
        setTrip(t)
        t = await syncTrip(t) // creates it on the server, or sends what changed since
      } else {
        t = await getTrip(DEMO_TRIP_ID) // nothing planned in this browser yet: show the demo trip
      }
      setTrip(t)
      await loadItinerary(t.id)
    } catch (e) {
      fail(e)
    }
  }, [loadItinerary])

  useEffect(() => {
    if (started.current) return
    started.current = true
    run()
  }, [run])

  const editable = !!trip?.stops.length // the demo trip is read-only

  const update = (patch: Partial<Trip>) => {
    setTrip((t) => (t ? { ...t, ...patch } : t))
    if (editable) saveTrip(patch)
    setRouteChanged(true)
  }
  const setRoute = (route: RouteStop[]) => update({ route })

  async function applyRouteChange() {
    setRouteChanged(false)
    setItinerary(null)
    setActive(0)
    setPhase("loading")
    try {
      const t = await syncTrip(loadTrip()) // the server drops the old plan, so this regenerates
      setTrip(t)
      await loadItinerary(t.id)
    } catch (e) {
      fail(e)
    }
  }

  const planned = trip ? planDays(trip.startDate, trip.route) : []
  const tripDays = trip ? daysBetween(trip.startDate, trip.endDate) : 0
  const days: ShownDay[] = itinerary
    ? itinerary.days.map((d) => {
        const p = planned.find((x) => x.date === d.date)
        return { ...p, ...d, city: p?.city ?? d.city ?? trip?.destination ?? "", country: p?.country ?? "" }
      })
    : planned.map((p) => ({ ...p, items: [] }))

  // Voice changes (stored in this browser) on top of the plan from the API.
  const baseDays: EditableDay[] = days.map((d, i) => ({
    day: i + 1,
    date: d.date,
    city: d.city,
    country: d.country,
    items: toEditable(d.items, places),
  }))
  const { days: shown, edited } = applyOverrides(baseDays, overrides)

  const activeIndex = Math.min(active, Math.max(0, days.length - 1))
  const day = days[activeIndex]
  const plan = shown[activeIndex]
  const items = plan?.items ?? []
  const isEdited = plan ? edited.has(plan.date) : false
  const cityChanged = !!(day && plan && plan.city !== day.city)

  const perPerson = itinerary?.total
  const group = perPerson && trip ? { ...perPerson, amount: perPerson.amount * trip.travellers } : null
  const budget = trip?.budget.amount && group && trip.budget.currency === group.currency ? trip.budget.amount : null

  // ---- map ----
  // Cities in travel order (after voice changes), with how many days in each.
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
  const coords = useCityCoords(segments.filter((s) => s.city))
  const centre = plan ? coords[cityKey(plan.city, plan.country)] : null
  // A stop is placed if it has coordinates near its city (a location that's far
  // away is treated as wrong and looked up again).
  const placed = (it: EditableItem) =>
    it.lat !== undefined && it.lng !== undefined && (!centre || distanceKm(centre, { lat: it.lat, lng: it.lng }) <= 120)
  const unplaced = plan ? items.filter((it) => !placed(it) && it.name !== "Unknown place") : []
  const placeCoords = useCityCoords(unplaced.map((it) => ({ city: plan!.city, country: plan!.country, place: it.name })))
  const mapCities: MapCity[] = segments.map((s) => ({ ...s, at: coords[cityKey(s.city, s.country)] }))
  const mapStops: MapStop[] = items.flatMap((it, i) => {
    const at = placed(it) ? { lat: it.lat!, lng: it.lng! } : placeCoords[cityKey(plan!.city, plan!.country, it.name)]
    return at ? [{ n: i + 1, name: it.name, category: it.category, lat: at.lat, lng: at.lng }] : []
  })
  const dayCity = plan ? { city: plan.city, at: centre } : null

  const selectDay = (i: number) => {
    setActive(i)
    setSelectedStop(null)
  }
  const selectStop = (n: number) => {
    setSelectedStop(n)
    document.getElementById(`stop-${n}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }

  // ---- voice changes ----
  const voiceContext = () => ({
    activeDay: activeIndex + 1,
    travellers: trip?.travellers,
    interests: trip?.interests,
    dayStart: trip?.dayStart,
    dayEnd: trip?.dayEnd,
    bookings: { stays: trip?.stays ?? [], transport: trip?.transport ?? [] },
    days: shown.map(({ day, date, city, country, items }) => ({ day, date, city, country, items })),
  })

  const onVoiceEdit = async (result: VoiceEditResult) => {
    if (!result.changes.length || !trip) return
    const next = mergeChanges(baseDays, overrides, result.changes)
    setOverrides(next)
    saveOverrides(trip.id, next)
    selectDay(Math.min(...result.changes.map((c) => c.day)) - 1) // show the change

    // The server checks the changed days (opening hours, travel time, holidays, prices) and saves
    // them into the plan. The demo trip is read-only: there the checked days stay in this browser.
    const changed = result.changes.map((c) => next[baseDays[c.day - 1]?.date]).filter(Boolean)
    if (!changed.length) return
    setChecking(true)
    try {
      const out = await checkDays(trip.id, changed)
      setCheckNotes((n) => ({ ...n, ...Object.fromEntries(out.days.map((d) => [d.date, d.problems])) }))
      const after = { ...next }
      for (const d of out.days) {
        if (out.saved) delete after[d.date] // it's in the stored plan now
        else if (after[d.date]) after[d.date] = { ...after[d.date], items: d.items }
      }
      saveOverrides(trip.id, after)
      if (out.saved) await loadItinerary(trip.id)
      else setOverrides(after)
    } catch {
      const note = ["We couldn't check this change just now, so opening hours and prices may be out of date."]
      setCheckNotes((n) => ({ ...n, ...Object.fromEntries(changed.map((d) => [d.date, note])) }))
    } finally {
      setChecking(false)
    }
  }

  const undoVoice = () => {
    setCheckNotes({})
    setOverrides({})
    if (trip) saveOverrides(trip.id, {})
  }

  return (
    <PageShell
      step={4}
      back="/import"
      title={`${trip?.destination || "Your"} itinerary`}
      subtitle={
        trip
          ? `${days.length} days · ${Math.max(trip.route.length, 1)} ${trip.route.length > 1 ? "stops" : "stop"} · ${trip.travellers} ${
              trip.travellers === 1 ? "traveller" : "travellers"
            }`
          : "Loading…"
      }
    >
      {days.length ? (
        <TripMap
          mode={mapCities.length > 1 ? mapMode : "day"}
          onModeChange={setMapMode}
          stops={mapStops}
          dayCity={dayCity}
          cities={mapCities}
          selected={selectedStop}
          onSelectStop={selectStop}
          onSelectCity={(firstDay) => {
            selectDay(firstDay)
            setMapMode("day")
          }}
        />
      ) : null}

      {SHOW_COSTS && perPerson && group ? (
        <div className="mb-4 rounded-xl bg-card p-3 text-sm ring-1 ring-foreground/10">
          <p className="inline-flex items-center gap-1.5 font-medium">
            <Wallet className="size-4 text-primary" /> About {formatMoney(perPerson)} per person
            {trip && trip.travellers > 1 ? ` · ${formatMoney(group)} for ${trip.travellers}` : ""}
          </p>
          {budget !== null ? (
            group.amount <= budget ? (
              <p className="mt-1 text-muted-foreground">
                Within your {formatMoney({ amount: budget, currency: group.currency })} budget, with about{" "}
                {formatMoney({ amount: budget - group.amount, currency: group.currency })} to spare.
              </p>
            ) : (
              <p className="mt-1 font-medium text-destructive">
                About {formatMoney({ amount: group.amount - budget, currency: group.currency })} over your{" "}
                {formatMoney({ amount: budget, currency: group.currency })} budget.
              </p>
            )
          ) : null}
        </div>
      ) : null}

      {editable && trip && (trip.route.length > 1 || tripDays !== planned.length) ? (
        <RouteEditor
          route={trip.route}
          tripDays={tripDays}
          onChange={setRoute}
          onReset={() => setRoute(recommendRoute(trip))}
          onFitEndDate={() => {
            const total = trip.route.reduce((n, r) => n + r.days, 0)
            update({ endDate: addDays(trip.startDate, total - 1) })
          }}
        />
      ) : null}

      {trip ? (
        <BookingsEditor
          stays={trip.stays ?? []}
          transport={trip.transport ?? []}
          startDate={trip.startDate}
          endDate={trip.endDate}
          readOnly={!editable}
          onChange={(patch) => update(patch)}
        />
      ) : null}

      {routeChanged && phase !== "generating" ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
          <p>You changed your trip. Update the plan to match?</p>
          <Button size="sm" onClick={applyRouteChange}>
            <RefreshCw /> Update
          </Button>
        </div>
      ) : null}

      {phase === "ready" && days.length ? (
        <VoiceEditButton
          context={voiceContext}
          onEdit={onVoiceEdit}
          footer={
            edited.size ? (
              <button
                onClick={undoVoice}
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <Undo2 className="size-3.5" /> Undo voice changes ({edited.size} {edited.size === 1 ? "day" : "days"})
              </button>
            ) : null
          }
        />
      ) : null}

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {shown.map((d, i) => (
          <button
            key={d.date}
            role="tab"
            aria-selected={i === activeIndex}
            onClick={() => selectDay(i)}
            className={`relative flex shrink-0 flex-col items-start rounded-2xl border px-4 py-1.5 text-left transition-colors ${
              i === activeIndex ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
            }`}
          >
            <span className="text-sm font-medium">
              Day {i + 1} <span className="opacity-70">· {formatDay(d.date)}</span>
            </span>
            <span className="text-xs opacity-80">
              {d.country ? <span aria-hidden>{flagOf(d.country)} </span> : null}
              {d.city}
              {days[i]?.holiday ? " · holiday" : ""}
            </span>
            {edited.has(d.date) ? (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-400" aria-label="changed by voice" />
            ) : null}
          </button>
        ))}
      </div>

      {day && plan ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {cityChanged
              ? `${plan.city} · instead of ${day.city}`
              : day.dayInCity && day.daysInCity
                ? `${plan.city} · day ${day.dayInCity} of ${day.daysInCity}`
                : plan.city}
            {isEdited ? " · changed by voice" : ""}
          </p>
          {phase === "ready" && items.length ? <ListenButton text={() => narrateDay(plan)} /> : null}
        </div>
      ) : null}

      {day?.holiday && !cityChanged ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
          <CalendarHeart className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            <span className="font-medium">{day.holiday}.</span> It’s a public holiday, so some places close or change
            their hours. We’ve planned around it and marked anything worth checking.
          </p>
        </div>
      ) : null}

      {day?.explore && !cityChanged ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
          <Compass className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            You’re exploring <span className="font-medium">{countryName(day.country)}</span>. We picked{" "}
            <span className="font-medium">{day.city}</span>, one of its most popular cities. Like it? Add it as a city on
            the first screen to plan around it.
          </p>
        </div>
      ) : null}

      {plan && trip ? <DayBookings date={plan.date} trip={trip} /> : null}
      {plan ? <CheckNote problems={checkNotes[plan.date]} checking={checking && isEdited} /> : null}

      {SHOW_COSTS && day?.total && items.length && !isEdited ? (
        <p className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium">
          <Wallet className="size-4 text-primary" /> About {formatMoney(day.total)} per person today
        </p>
      ) : null}

      {phase === "generating" || phase === "loading" ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-primary" />
          {phase === "generating" ? (
            <>
              <p className="font-medium text-foreground">Planning your trip…</p>
              <p>Checking opening hours, public holidays and prices. This takes about a minute.</p>
            </>
          ) : (
            <p>Loading your trip…</p>
          )}
        </div>
      ) : phase === "error" ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center text-sm">
          <p role="alert" className="text-destructive">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={run}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : items.length ? (
        <ol className="relative flex flex-col gap-3 border-l border-border pl-5">
          {items.map((item, i) => (
            <li key={`${item.time}-${item.name}-${i}`} id={`stop-${i + 1}`} className="relative scroll-mt-4">
              {i > 0 ? (
                <TravelHint prev={items[i - 1]} item={item} />
              ) : plan && trip && stayStart(stayOn(plan.date, trip.stays), trip.dayStart) ? (
                <TravelHint prev={stayStart(stayOn(plan.date, trip.stays), trip.dayStart)!} item={item} from="your accommodation" />
              ) : null}
              <span
                aria-hidden
                style={{ background: categoryColour(item.category) }}
                className="absolute top-3 -left-[31px] flex size-[22px] items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold text-white"
              >
                {i + 1}
              </span>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={selectedStop === i + 1}
                onClick={() => setSelectedStop(selectedStop === i + 1 ? null : i + 1)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setSelectedStop(i + 1)
                  }
                }}
                className={`cursor-pointer rounded-xl bg-card p-3 transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selectedStop === i + 1 ? "ring-2 ring-primary" : "ring-1 ring-foreground/10"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground tabular-nums">{item.time}</p>
                    <p className="font-medium">{item.name}</p>
                    {item.localName ? <p className="text-xs text-muted-foreground">{item.localName}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {item.category ? (
                      <Badge variant="secondary" className="capitalize">
                        {item.category}
                      </Badge>
                    ) : null}
                    <StatusBadge status={item.status} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {formatDuration(item.durationMins)}
                  </span>
                  {item.note ? <span>{item.note}</span> : null}
                  {SHOW_COSTS ? <Cost item={item} /> : null}
                </div>
                {item.tip ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted px-2 py-1.5 text-xs">
                    <Lightbulb className="mt-px size-3.5 shrink-0" />
                    {item.tip}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {day ? `Nothing planned for ${plan?.city ?? day.city} on this day.` : "Nothing planned yet."}
        </div>
      )}

      {phase === "ready" ? (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Opening hours checked with Google. Prices are estimates per person.
        </p>
      ) : null}
    </PageShell>
  )
}
