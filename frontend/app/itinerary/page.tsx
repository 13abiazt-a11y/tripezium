"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { CalendarHeart, Clock, Compass, Lightbulb, Loader2, RefreshCw, Undo2, Wallet } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { BudgetCard } from "@/components/budget-card"
import { Cost, formatDay, formatDuration, StatusBadge, TravelHint } from "@/components/plan-bits"
import { ListenButton } from "@/components/ListenButton"
import { PageShell } from "@/components/page-shell"
import { RouteEditor } from "@/components/route-editor"
import { categoryColour, TripMap, type MapCity, type MapMode, type MapStop } from "@/components/trip-map"
import { VoiceEditButton } from "@/components/VoiceEditButton"
import { DEMO_TRIP_ID, generateItinerary, getItinerary, getPlaces, getTrip, syncTrip } from "@/lib/api"
import { countryName, flagOf } from "@/lib/destinations"
import { SHOW_COSTS } from "@/lib/flags"
import { cityKey, useCityCoords } from "@/lib/geo"
import { formatMoney } from "@/lib/money"
import { narrateDay } from "@/lib/narration"
import { addDays, daysBetween, planDays, recommendRoute } from "@/lib/route"
import { loadTrip, saveTrip } from "@/lib/trip-store"
import { buildDays, citySegments, planTotals, withVoiceChanges } from "@/lib/plan-view"
import type { Itinerary, Place, RouteStop, Trip } from "@/lib/types"
import { useDayStops } from "@/lib/use-day-stops"
import { loadOverrides, mergeChanges, saveOverrides, type Overrides, type VoiceEditResult } from "@/lib/voice-edits"

type Phase = "loading" | "generating" | "ready" | "error"

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
  const days = buildDays(trip, itinerary)
  // Voice changes (stored in this browser) on top of the plan from the API.
  const { baseDays, shown, edited } = withVoiceChanges(days, places, overrides)

  const activeIndex = Math.min(active, Math.max(0, days.length - 1))
  const day = days[activeIndex]
  const plan = shown[activeIndex]
  const items = plan?.items ?? []
  const isEdited = plan ? edited.has(plan.date) : false
  const cityChanged = !!(day && plan && plan.city !== day.city)

  // Costs follow the plan: voice-changed days use their activities' prices.
  const { total: perPerson, dayTotals, unpriced } = planTotals(days, shown, edited, itinerary)
  const budget = trip?.budget.amount && perPerson && trip.budget.currency === perPerson.currency ? trip.budget.amount : null
  // The budget isn't part of the plan, so changing it doesn't re-plan the trip.
  const changeBudget = (amount: number | null) => {
    if (!trip) return
    const next = { ...trip.budget, amount }
    setTrip({ ...trip, budget: next })
    saveTrip({ budget: next })
  }

  // ---- map ----
  const segments = citySegments(shown, activeIndex)
  const coords = useCityCoords(segments.filter((s) => s.city))
  const centre = plan ? coords[cityKey(plan.city, plan.country)] : null
  const mapCities: MapCity[] = segments.map((s) => ({ ...s, at: coords[cityKey(s.city, s.country)] }))
  const mapStops: MapStop[] = useDayStops(plan, centre)
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
    currency: itinerary?.total.currency, // new activities get prices in this currency
    dayEnd: trip?.dayEnd,
    days: shown.map(({ day, date, city, country, items }) => ({ day, date, city, country, items })),
  })

  const onVoiceEdit = (result: VoiceEditResult) => {
    if (!result.changes.length || !trip) return
    // TODO(A+C): send result.changes to the API so the server plan changes too.
    const next = mergeChanges(baseDays, overrides, result.changes)
    setOverrides(next)
    saveOverrides(trip.id, next)
    selectDay(Math.min(...result.changes.map((c) => c.day)) - 1) // show the change
  }

  const undoVoice = () => {
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
      footer={
        phase === "ready" && days.length ? (
          <Link href="/trip" className={buttonVariants({ size: "lg", className: "h-12 w-full text-base" })}>
            Finalise my plan
          </Link>
        ) : null
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

      {SHOW_COSTS && perPerson && trip ? (
        <BudgetCard
          perPerson={perPerson}
          travellers={trip.travellers}
          budget={budget}
          editable={editable && trip.budget.currency === perPerson.currency}
          changedDays={edited.size}
          unpriced={unpriced}
          onChangeBudget={changeBudget}
        />
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

      {routeChanged && phase !== "generating" ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
          <p>You changed your route. Update the plan to match?</p>
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
              i === activeIndex ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
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

      {SHOW_COSTS && dayTotals[activeIndex] && items.length ? (
        <p className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium">
          <Wallet className="size-4 text-primary" /> About {formatMoney(dayTotals[activeIndex]!)} per person today
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
              {i > 0 ? <TravelHint prev={items[i - 1]} item={item} className="mb-1.5" /> : null}
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
