"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CalendarHeart, Clock, Compass, Lightbulb, Loader2, MapPin, RefreshCw, Wallet } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/page-shell"
import { RouteEditor } from "@/components/route-editor"
import { DEMO_TRIP_ID, generateItinerary, getItinerary, getPlaces, getTrip, syncTrip } from "@/lib/api"
import { countryName, flagOf } from "@/lib/destinations"
import { SHOW_COSTS } from "@/lib/flags"
import { formatMoney } from "@/lib/money"
import { addDays, daysBetween, planDays, recommendRoute } from "@/lib/route"
import { loadTrip, saveTrip } from "@/lib/trip-store"
import type { Itinerary, ItineraryItem, Money, Place, RouteStop, Trip } from "@/lib/types"

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

function Cost({ item }: { item: ItineraryItem }) {
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
  const activeIndex = Math.min(active, Math.max(0, days.length - 1))
  const day = days[activeIndex]
  const items = day?.items ?? []

  const perPerson = itinerary?.total
  const group = perPerson && trip ? { ...perPerson, amount: perPerson.amount * trip.travellers } : null
  const budget = trip?.budget.amount && group && trip.budget.currency === group.currency ? trip.budget.amount : null

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
      {/* Map goes here (B: Leaflet) */}
      <div className="mb-4 flex h-40 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
        <MapPin className="mr-1.5 size-4" /> Map
      </div>

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

      {routeChanged && phase !== "generating" ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
          <p>You changed your route. Update the plan to match?</p>
          <Button size="sm" onClick={applyRouteChange}>
            <RefreshCw /> Update
          </Button>
        </div>
      ) : null}

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {days.map((d, i) => (
          <button
            key={d.date}
            role="tab"
            aria-selected={i === activeIndex}
            onClick={() => setActive(i)}
            className={`flex shrink-0 flex-col items-start rounded-2xl border px-4 py-1.5 text-left transition-colors ${
              i === activeIndex ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
            }`}
          >
            <span className="text-sm font-medium">
              Day {i + 1} <span className="opacity-70">· {formatDay(d.date)}</span>
            </span>
            <span className="text-xs opacity-80">
              {d.country ? <span aria-hidden>{flagOf(d.country)} </span> : null}
              {d.city}
              {d.holiday ? " · holiday" : ""}
            </span>
          </button>
        ))}
      </div>

      {day && day.dayInCity && day.daysInCity ? (
        <p className="mb-3 text-sm text-muted-foreground">
          {day.city} · day {day.dayInCity} of {day.daysInCity}
        </p>
      ) : null}

      {day?.holiday ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
          <CalendarHeart className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            <span className="font-medium">{day.holiday}.</span> It’s a public holiday, so some places close or change
            their hours. We’ve planned around it and marked anything worth checking.
          </p>
        </div>
      ) : null}

      {day?.explore ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
          <Compass className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            You’re exploring <span className="font-medium">{countryName(day.country)}</span>. We picked{" "}
            <span className="font-medium">{day.city}</span>, one of its most popular cities. Like it? Add it as a city on
            the first screen to plan around it.
          </p>
        </div>
      ) : null}

      {SHOW_COSTS && day?.total && items.length ? (
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
          {items.map((item) => {
            const p = places.get(item.placeId)
            return (
              <li key={item.time + item.placeId} className="relative">
                <span className="absolute top-4 -left-[26px] size-3 rounded-full border-2 border-background bg-primary" />
                <div className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground tabular-nums">{item.time}</p>
                      <p className="font-medium">{p?.nameEnglish ?? "Unknown place"}</p>
                      {p && p.name !== p.nameEnglish ? <p className="text-xs text-muted-foreground">{p.name}</p> : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {p?.category ? <Badge variant="secondary" className="capitalize">{p.category}</Badge> : null}
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{formatDuration(item.durationMins)}</span>
                    {item.note ? <span>{item.note}</span> : null}
                    {SHOW_COSTS ? <Cost item={item} /> : null}
                  </div>
                  {p?.tip ? (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted px-2 py-1.5 text-xs">
                      <Lightbulb className="mt-px size-3.5 shrink-0" />{p.tip}
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {day ? `Nothing planned for ${day.city} on this day.` : "Nothing planned yet."}
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
