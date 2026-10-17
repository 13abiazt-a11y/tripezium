"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Clock,
  Compass,
  Lightbulb,
  Loader2,
  RotateCcw,
  Sparkles,
  Undo2,
  Wallet,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ListenButton } from "@/components/ListenButton"
import { PageShell } from "@/components/page-shell"
import { RouteEditor } from "@/components/route-editor"
import {
  categoryColour,
  TripMap,
  type MapCity,
  type MapMode,
  type MapStop,
} from "@/components/trip-map"
import { VoiceEditButton } from "@/components/VoiceEditButton"
import { countryName, flagOf } from "@/lib/destinations"
import { loadPlans, planKey, savePlans, type DayPlans } from "@/lib/day-plans"
import { cityKey, distanceKm, useCityCoords } from "@/lib/geo"
import { SHOW_COSTS } from "@/lib/flags"
import { formatMoney, totals } from "@/lib/money"
import { narrateDay } from "@/lib/narration"
import { sampleDay } from "@/lib/sample-day"
import { mockItinerary, mockPlaces, mockTrip } from "@/lib/mock"
import { addDays, daysBetween, planDays, recommendRoute } from "@/lib/route"
import { loadTrip, saveTrip } from "@/lib/trip-store"
import type { ItineraryItem, Place, RouteStop, Trip } from "@/lib/types"
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
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ")
}

function toEditable(
  items: ItineraryItem[],
  lookup: (id: string) => Place | undefined
): EditableItem[] {
  return items.map((i) => {
    const p = lookup(i.placeId)
    return {
      time: i.time,
      name: p?.nameEnglish ?? "Unknown place",
      ...(p && p.name !== p.nameEnglish ? { localName: p.name } : {}),
      category: p?.category ?? "activity",
      durationMins: i.durationMins,
      ...(i.note ? { note: i.note } : {}),
      ...(p?.tip ? { tip: p.tip } : {}),
      ...(i.cost ? { cost: i.cost } : {}),
      ...(p && (p.lat || p.lng) ? { lat: p.lat, lng: p.lng } : {}),
    }
  })
}

export default function ItineraryPage() {
  // TODO(A+C): replace mocks with GET /trips/{id}/itinerary
  const [trip, setTrip] = useState<Trip>(mockTrip)
  const places = useMemo(
    () => new Map<string, Place>(mockPlaces.map((p) => [p.id, p])),
    []
  )
  const [active, setActive] = useState(0)
  const [overrides, setOverrides] = useState<Overrides>({})
  const [mapMode, setMapMode] = useState<MapMode>("day")
  const [selectedStop, setSelectedStop] = useState<number | null>(null)
  const [plans, setPlans] = useState<DayPlans>({})
  const [plansFor, setPlansFor] = useState<string | null>(null) // trip whose saved plans are loaded
  const [planning, setPlanning] = useState<{
    key: string
    error?: string
  } | null>(null)

  useEffect(() => {
    const t = loadTrip()
    if (t.stops.length && t.startDate) {
      if (!t.route.length) t.route = recommendRoute(t)
      setTrip(t)
    }
  }, [])

  // Voice changes are stored per trip in this browser.
  // Days planned with real places are stored the same way.
  useEffect(() => {
    setOverrides(loadOverrides(trip.id))
    setPlans(loadPlans(trip.id))
    setPlansFor(trip.id)
  }, [trip.id])

  const update = (patch: Partial<Trip>) => {
    setTrip((t) => ({ ...t, ...patch }))
    if (trip.id !== mockTrip.id) saveTrip(patch)
  }
  const setRoute = (route: RouteStop[]) => update({ route })

  const tripDays = daysBetween(trip.startDate, trip.endDate)
  const days = planDays(trip.startDate, trip.route)

  // Planned activities for every day. Real-looking mock activities only exist
  // for Tokyo; other days are planned with real places by /api/plan-day when
  // first opened (placeholder activities until then), until C's itinerary
  // endpoint is live.
  const tokyoDays = days.filter((d) => d.city === "Tokyo").map((d) => d.date)
  const baseDays: (EditableDay & { sample: boolean; aiPlanned?: boolean })[] =
    days.map((d, i) => {
      const tokyo =
        d.city === "Tokyo"
          ? mockItinerary[tokyoDays.indexOf(d.date)]?.items
          : undefined
      if (tokyo) {
        return {
          day: i + 1,
          date: d.date,
          city: d.city,
          country: d.country,
          items: toEditable(tokyo, (id) => places.get(id)),
          sample: false,
        }
      }
      const generated = plans[planKey(d.date, d.city)]
      if (generated?.length) {
        return {
          day: i + 1,
          date: d.date,
          city: d.city,
          country: d.country,
          items: generated,
          sample: false,
          aiPlanned: true,
        }
      }
      const s = sampleDay(d.city, d.dayInCity, trip.budget.currency)
      const lookup = (id: string) => s.places.find((p) => p.id === id)
      return {
        day: i + 1,
        date: d.date,
        city: d.city,
        country: d.country,
        items: toEditable(s.items, lookup),
        sample: true,
      }
    })
  const { days: planned, edited } = applyOverrides(baseDays, overrides)

  const activeIndex = Math.min(active, Math.max(0, days.length - 1))
  const day = days[activeIndex]
  const plan = planned[activeIndex]
  const isEdited = plan ? edited.has(plan.date) : false
  const cityChanged = !!(day && plan && plan.city !== day.city)
  const sample = !isEdited && !!baseDays[activeIndex]?.sample
  const aiPlanned = !isEdited && !!baseDays[activeIndex]?.aiPlanned

  // Plan the day being viewed with real places if it only has placeholders.
  // (Wait until this trip's saved plans are loaded, so a refresh doesn't re-plan.)
  const needPlan =
    sample && day && plansFor === trip.id ? planKey(day.date, day.city) : null
  const planError =
    needPlan && planning?.key === needPlan ? planning.error : undefined
  const isPlanning = !!needPlan && !planError
  useEffect(() => {
    if (!needPlan || !day || (planning?.key === needPlan && planning.error))
      return
    let cancelled = false
    // Real places already planned in this city (not placeholders), so days don't repeat.
    const avoid = planned
      .filter(
        (d, i) =>
          d.city === day.city && !(baseDays[i]?.sample && !edited.has(d.date))
      )
      .flatMap((d) => d.items.map((i) => i.name))
    ;(async () => {
      setPlanning({ key: needPlan })
      try {
        const res = await fetch("/api/plan-day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city: day.city,
            country: day.country,
            date: day.date,
            dayInCity: day.dayInCity,
            daysInCity: day.daysInCity,
            interests: trip.interests,
            travellers: trip.travellers,
            dayStart: trip.dayStart,
            dayEnd: trip.dayEnd,
            avoid,
          }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.items?.length)
          throw new Error(data?.error ?? "Couldn't plan this day")
        // Keep the plan even if they've moved to another day meanwhile.
        setPlans((p) => {
          if (p[needPlan]) return p
          const next = { ...p, [needPlan]: data.items }
          savePlans(trip.id, next)
          return next
        })
        if (!cancelled) setPlanning(null)
      } catch (e) {
        if (!cancelled)
          setPlanning({ key: needPlan, error: (e as Error).message })
      }
    })()
    return () => {
      cancelled = true
    }
    // Only re-run when the day that needs planning changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needPlan, planning?.error])
  const items = plan?.items ?? []
  const dayTotals = totals(items.flatMap((i) => (i.cost ? [i.cost] : [])))

  // ---- map ----
  // Cities in travel order (after voice changes), with how many days in each.
  const segments: Omit<MapCity, "at">[] = []
  planned.forEach((d, i) => {
    const last = segments.at(-1)
    if (last && last.city === d.city && last.country === d.country) last.days++
    else
      segments.push({
        city: d.city,
        country: d.country,
        days: 1,
        firstDay: i,
        active: false,
      })
  })
  segments.forEach((s, i) => {
    const next = segments[i + 1]?.firstDay ?? planned.length
    s.active = activeIndex >= s.firstDay && activeIndex < next
  })
  // Real activities that came without coordinates are looked up by name.
  const coords = useCityCoords(segments)
  const centre = plan ? coords[cityKey(plan.city, plan.country)] : null
  // A stop is placed if it has coordinates near its city (a saved location
  // that's far away is treated as wrong and looked up again).
  const placed = (it: EditableItem) =>
    it.lat !== undefined &&
    it.lng !== undefined &&
    (!centre || distanceKm(centre, { lat: it.lat, lng: it.lng }) <= 120)
  const unplaced = sample || !plan ? [] : items.filter((it) => !placed(it))
  const placeCoords = useCityCoords(
    unplaced.map((it) => ({
      city: plan!.city,
      country: plan!.country,
      place: it.name,
    }))
  )
  const mapCities: MapCity[] = segments.map((s) => ({
    ...s,
    at: coords[cityKey(s.city, s.country)],
  }))
  const mapStops: MapStop[] = sample
    ? []
    : items.flatMap((it, i) => {
        const at = placed(it)
          ? { lat: it.lat!, lng: it.lng! }
          : placeCoords[cityKey(plan!.city, plan!.country, it.name)]
        return at
          ? [
              {
                n: i + 1,
                name: it.name,
                category: it.category,
                lat: at.lat,
                lng: at.lng,
              },
            ]
          : []
      })
  const dayCity = plan
    ? { city: plan.city, at: coords[cityKey(plan.city, plan.country)] }
    : null

  const selectDay = (i: number) => {
    setActive(i)
    setSelectedStop(null)
  }
  const selectStop = (n: number) => {
    setSelectedStop(n)
    document
      .getElementById(`stop-${n}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }

  const voiceContext = () => ({
    activeDay: activeIndex + 1,
    travellers: trip.travellers,
    interests: trip.interests,
    dayStart: trip.dayStart,
    dayEnd: trip.dayEnd,
    days: planned.map(({ day, date, city, country, items }) => ({
      day,
      date,
      city,
      country,
      items,
    })),
  })

  const onVoiceEdit = (result: VoiceEditResult) => {
    if (!result.changes.length) return
    // TODO(A+C): send result.changes to C's itinerary endpoint once it exists.
    const next = mergeChanges(baseDays, overrides, result.changes)
    setOverrides(next)
    saveOverrides(trip.id, next)
    // Jump to the first changed day so the change is visible.
    selectDay(Math.min(...result.changes.map((c) => c.day)) - 1)
  }

  const undoVoice = () => {
    setOverrides({})
    saveOverrides(trip.id, {})
  }

  return (
    <PageShell
      step={4}
      back="/import"
      title={`${trip.destination || "Your"} itinerary`}
      subtitle={`${days.length} days · ${trip.route.length} ${trip.route.length === 1 ? "stop" : "stops"} · ${trip.travellers} ${
        trip.travellers === 1 ? "traveller" : "travellers"
      }`}
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

      {trip.route.length > 1 || tripDays !== days.length ? (
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

      {days.length ? (
        <VoiceEditButton
          context={voiceContext}
          onEdit={onVoiceEdit}
          footer={
            edited.size ? (
              <button
                onClick={undoVoice}
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <Undo2 className="size-3.5" /> Undo voice changes ({edited.size}{" "}
                {edited.size === 1 ? "day" : "days"})
              </button>
            ) : null
          }
        />
      ) : null}

      <div
        className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1"
        role="tablist"
      >
        {planned.map((d, i) => (
          <button
            key={d.date}
            role="tab"
            aria-selected={i === activeIndex}
            onClick={() => selectDay(i)}
            className={`relative flex shrink-0 flex-col items-start rounded-2xl border px-4 py-1.5 text-left transition-colors ${
              i === activeIndex
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-muted"
            }`}
          >
            <span className="text-sm font-medium">
              Day {i + 1}{" "}
              <span className="opacity-70">· {formatDay(d.date)}</span>
            </span>
            <span className="text-xs opacity-80">
              <span aria-hidden>{flagOf(d.country)}</span> {d.city}
            </span>
            {edited.has(d.date) ? (
              <span
                className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-400"
                aria-label="changed by voice"
              />
            ) : null}
          </button>
        ))}
      </div>

      {day && plan ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {cityChanged
              ? `${plan.city} · instead of ${day.city}`
              : `${plan.city} · day ${day.dayInCity} of ${day.daysInCity}`}
            {sample && !isPlanning ? " · sample plan" : ""}
            {aiPlanned ? " · planned with AI" : ""}
            {isEdited ? " · changed by voice" : ""}
          </p>
          <ListenButton text={() => narrateDay(plan)} />
        </div>
      ) : null}

      {day?.explore && !cityChanged ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
          <Compass className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            You’re exploring{" "}
            <span className="font-medium">{countryName(day.country)}</span>. We
            picked <span className="font-medium">{day.city}</span>, one of its
            most popular cities. Like it? Add it as a city on the first screen
            to plan around it.
          </p>
        </div>
      ) : null}

      {SHOW_COSTS && dayTotals.length ? (
        <p className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium">
          <Wallet className="size-4 text-primary" /> About{" "}
          {dayTotals.map(formatMoney).join(" + ")} per person today
        </p>
      ) : null}

      {isPlanning ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Planning day{" "}
            {activeIndex + 1} in {day?.city} with real places…
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <>
          {planError ? (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                <Sparkles className="mr-1 inline size-3.5" />
                {planError}. Showing a sample day.
              </span>
              <button
                onClick={() => setPlanning(null)}
                className="inline-flex items-center gap-1 font-medium text-primary"
              >
                <RotateCcw className="size-3.5" /> Retry
              </button>
            </div>
          ) : null}
          {items.length ? (
            <ol className="relative flex flex-col gap-3 border-l border-border pl-5">
              {items.map((item, i) => (
                <li
                  key={`${item.time}-${item.name}-${i}`}
                  id={`stop-${i + 1}`}
                  className="relative scroll-mt-4"
                >
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
                    onClick={() =>
                      setSelectedStop(selectedStop === i + 1 ? null : i + 1)
                    }
                    onKeyDown={(e) =>
                      (e.key === "Enter" || e.key === " ") &&
                      (e.preventDefault(), setSelectedStop(i + 1))
                    }
                    className={`cursor-pointer rounded-xl bg-card p-3 transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selectedStop === i + 1
                        ? "ring-2 ring-primary"
                        : "ring-1 ring-foreground/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground tabular-nums">
                          {item.time}
                        </p>
                        <p className="font-medium">{item.name}</p>
                        {item.localName ? (
                          <p className="text-xs text-muted-foreground">
                            {item.localName}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant="secondary" className="capitalize">
                        {item.category}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" />
                        {formatDuration(item.durationMins)}
                      </span>
                      {item.note ? <span>{item.note}</span> : null}
                      {SHOW_COSTS && item.cost ? (
                        <span className="font-medium text-foreground">
                          {item.cost.amount === 0
                            ? "Free"
                            : `~${formatMoney(item.cost)}`}
                        </span>
                      ) : null}
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
              {day
                ? `Activities for ${plan?.city ?? day.city} will appear here once the itinerary is generated.`
                : "Nothing planned yet."}
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
