"use client"

// The finished plan, read-only and easy to scan: summary card, map that follows
// the day you're reading, then every day in order. Used for the plan you're
// working on (/trip) and for trips saved to the home page (/trips/[id]).
import { useEffect, useRef, useState } from "react"
import { CalendarHeart, Clock, Lightbulb } from "lucide-react"

import { ListenButton } from "@/components/ListenButton"
import { Cost, formatDay, formatDuration, StatusBadge, TravelHint } from "@/components/plan-bits"
import { categoryColour, TripMap, type MapCity, type MapMode } from "@/components/trip-map"
import { flagOf } from "@/lib/destinations"
import { SHOW_COSTS } from "@/lib/flags"
import { cityKey, useCityCoords } from "@/lib/geo"
import { formatMoney } from "@/lib/money"
import { narrateDay } from "@/lib/narration"
import { buildDays, citySegments, planTotals, withVoiceChanges } from "@/lib/plan-view"
import type { Itinerary, Place, Trip } from "@/lib/types"
import { useDayStops } from "@/lib/use-day-stops"
import type { Overrides } from "@/lib/voice-edits"

export function dateRange(start: string, end: string) {
  const s = new Date(start + "T00:00:00")
  const e = new Date(end + "T00:00:00")
  const sameYear = s.getFullYear() === e.getFullYear()
  const from = s.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })
  const to = e.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
  return start === end ? to : `${from} – ${to}`
}

export function FinalPlan({
  trip,
  itinerary,
  places,
  overrides,
  kicker = "Your trip is planned",
  actions,
}: {
  trip: Trip
  itinerary: Itinerary
  places: Map<string, Place>
  overrides: Overrides
  kicker?: string
  actions?: React.ReactNode // buttons under the last day
}) {
  const [active, setActive] = useState(0)
  const [mapMode, setMapMode] = useState<MapMode>("trip")
  const [selected, setSelected] = useState<number | null>(null)
  const jumping = useRef(false) // ignore scroll tracking while we scroll to a day ourselves

  const days = buildDays(trip, itinerary)
  const { shown, edited } = withVoiceChanges(days, places, overrides)
  const { total: perPerson, dayTotals } = planTotals(days, shown, edited, itinerary)
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1))
  const activeDay = shown[activeIndex]

  const segments = citySegments(shown, activeIndex)
  const coords = useCityCoords(segments.filter((s) => s.city))
  const mapCities: MapCity[] = segments.map((s) => ({ ...s, at: coords[cityKey(s.city, s.country)] }))
  const centre = activeDay ? coords[cityKey(activeDay.city, activeDay.country)] : null
  const mapStops = useDayStops(activeDay, centre)

  // The map follows the day you're reading.
  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>("[data-day]")]
    const io = new IntersectionObserver(
      (entries) => {
        if (jumping.current) return
        const hit = entries.find((e) => e.isIntersecting)
        if (hit) {
          setActive(Number((hit.target as HTMLElement).dataset.day))
          setSelected(null)
        }
      },
      { rootMargin: "-35% 0px -60% 0px" },
    )
    sections.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [shown.length])

  const goToDay = (i: number) => {
    setActive(i)
    setSelected(null)
    setMapMode("day")
    jumping.current = true
    document.getElementById(`day-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
    window.setTimeout(() => (jumping.current = false), 800)
  }

  const group = perPerson ? { ...perPerson, amount: perPerson.amount * trip.travellers } : null
  const budget = trip.budget.amount && group && trip.budget.currency === group.currency ? trip.budget.amount : null
  const cityNames = segments.map((s) => s.city).filter(Boolean)

  return (
    <>
      {/* The finished trip at a glance */}
      <section className="mb-4 rounded-2xl bg-primary p-5 text-primary-foreground shadow-[0_10px_30px_-12px_rgba(0,110,80,0.55)] print:shadow-none">
        <p className="text-sm font-medium opacity-80">{kicker}</p>
        <h1 className="mt-1 text-3xl leading-tight font-semibold tracking-tight text-balance">
          {trip.destination || cityNames.join(" & ")}
        </h1>
        <p className="mt-2 text-sm opacity-90">
          {dateRange(trip.startDate, shown.at(-1)?.date ?? trip.endDate)}, {shown.length} {shown.length === 1 ? "day" : "days"},{" "}
          {trip.travellers} {trip.travellers === 1 ? "traveller" : "travellers"}
        </p>
        {cityNames.length > 1 ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium">
            {segments.map((s, i) => (
              <span key={s.firstDay} className="inline-flex items-center gap-1.5">
                {i ? (
                  <span aria-hidden className="opacity-60">
                    ›
                  </span>
                ) : null}
                <span>
                  {s.city} <span className="opacity-70">{s.days}d</span>
                </span>
              </span>
            ))}
          </p>
        ) : null}
        {SHOW_COSTS && perPerson && group ? (
          <div className="mt-4 border-t border-primary-foreground/25 pt-3">
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoney(perPerson)} <span className="text-sm font-normal opacity-80">per person</span>
            </p>
            <p className="text-sm opacity-85">
              {trip.travellers > 1 ? `${formatMoney(group)} for all ${trip.travellers}` : "Estimated total"}
              {budget !== null
                ? group.amount <= budget
                  ? `, ${formatMoney({ amount: budget - group.amount, currency: group.currency })} under your ${formatMoney({ amount: budget, currency: group.currency })} budget`
                  : `, ${formatMoney({ amount: group.amount - budget, currency: group.currency })} over your ${formatMoney({ amount: budget, currency: group.currency })} budget`
                : ""}
            </p>
          </div>
        ) : null}
      </section>

      <div className="print:hidden">
        <TripMap
          mode={mapCities.length > 1 ? mapMode : "day"}
          onModeChange={setMapMode}
          stops={mapStops}
          dayCity={activeDay ? { city: activeDay.city, at: centre } : null}
          cities={mapCities}
          selected={selected}
          onSelectStop={(n) => {
            setSelected(n)
            document.getElementById(`stop-${activeIndex + 1}-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
          }}
          onSelectCity={goToDay}
        />
      </div>

      {/* Jump to a day */}
      <nav
        aria-label="Days"
        className="sticky top-0 z-[1001] -mx-4 mb-2 flex gap-1.5 overflow-x-auto bg-background/90 px-4 py-2 backdrop-blur print:hidden"
      >
        {shown.map((d, i) => (
          <button
            key={d.date}
            onClick={() => goToDay(i)}
            aria-current={i === activeIndex ? "true" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              i === activeIndex ? "bg-foreground text-background" : "bg-card text-foreground ring-1 ring-foreground/10 hover:bg-muted"
            }`}
          >
            Day {i + 1}
            <span className="ml-1 font-normal opacity-70">{d.city}</span>
          </button>
        ))}
      </nav>

      <div className="flex flex-col gap-4">
        {shown.map((d, i) => {
          const info = days[i]
          const dayTotal = dayTotals[i]
          return (
            <section
              key={d.date}
              id={`day-${i + 1}`}
              data-day={i}
              className="scroll-mt-16 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 break-inside-avoid"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg leading-tight font-semibold">Day {i + 1}</h2>
                  <p className="text-sm text-muted-foreground">
                    {formatDay(d.date, true)} in{" "}
                    <span className="text-foreground">
                      {d.country ? <span aria-hidden>{flagOf(d.country)} </span> : null}
                      {d.city}
                    </span>
                  </p>
                </div>
                {d.items.length ? (
                  <span className="print:hidden">
                    <ListenButton text={() => narrateDay(d)} />
                  </span>
                ) : null}
              </div>

              {info?.holiday ? (
                <p className="mb-3 flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                  <CalendarHeart className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    <span className="font-medium">{info.holiday}.</span> Some places may close or change hours.
                  </span>
                </p>
              ) : null}

              {d.items.length ? (
                <ol className="flex flex-col">
                  {d.items.map((item, n) => {
                    const isSel = i === activeIndex && selected === n + 1
                    return (
                      <li
                        key={`${item.time}-${item.name}-${n}`}
                        id={`stop-${i + 1}-${n + 1}`}
                        className={`relative grid grid-cols-[3.25rem_1fr] gap-x-3 rounded-lg py-2.5 ${
                          n ? "border-t border-border" : ""
                        } ${isSel ? "bg-secondary/70" : ""}`}
                      >
                        {n > 0 ? (
                          <TravelHint prev={d.items[n - 1]} item={item} className="col-start-2 -mt-0.5 mb-1.5" />
                        ) : null}
                        <div className="pt-0.5 text-sm font-semibold tabular-nums">{item.time}</div>
                        <div className="flex min-w-0 items-start gap-2">
                          <span
                            aria-hidden
                            style={{ background: categoryColour(item.category) }}
                            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                          >
                            {n + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="leading-snug font-medium">{item.name}</p>
                            {item.localName ? <p className="text-xs text-muted-foreground">{item.localName}</p> : null}
                            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="size-3.5" />
                                {formatDuration(item.durationMins)}
                              </span>
                              {item.note ? <span>{item.note}</span> : null}
                              {SHOW_COSTS ? <Cost item={item} /> : null}
                              <StatusBadge status={item.status} />
                            </p>
                            {item.tip ? (
                              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                                <Lightbulb className="mt-px size-3.5 shrink-0 text-primary" />
                                {item.tip}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">A free day. Nothing planned.</p>
              )}

              {SHOW_COSTS && dayTotal && d.items.length ? (
                <p className="mt-2 border-t border-border pt-2 text-right text-xs text-muted-foreground">
                  Day total <span className="font-medium text-foreground">{formatMoney(dayTotal)}</span> per person
                </p>
              ) : null}
            </section>
          )
        })}
      </div>

      {actions ? <div className="mt-6 flex flex-col gap-2 print:hidden">{actions}</div> : null}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Opening hours checked with Google. Prices are estimates per person.
      </p>
    </>
  )
}
