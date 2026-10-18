"use client"

// Home: the next trip front and centre, start a new holiday, carry on with the
// one in progress, the other upcoming trips, and past trips.
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { ArrowRight, ChevronDown, Plus } from "lucide-react"

import { Brand } from "@/components/brand"
import { dateRange } from "@/components/final-plan"
import { Splash } from "@/components/splash"
import { countdown, PALETTE, TripStamp, tripColour } from "@/components/trip-stamp"
import { Button } from "@/components/ui/button"
import { isServerTrip } from "@/lib/api"
import { SHOW_COSTS } from "@/lib/flags"
import { formatMoney } from "@/lib/money"
import { buildDays, planTotals, withVoiceChanges } from "@/lib/plan-view"
import { daysBetween, summarise } from "@/lib/route"
import { listSaved, withColours, type SavedTrip } from "@/lib/saved-trips"
import { loadTrip, startNewTrip } from "@/lib/trip-store"
import type { Trip } from "@/lib/types"

/** The trip's main city (first on the route), for its stamp. */
function cityOf(trip: Trip) {
  return trip.route[0]?.city || trip.stops[0]?.cities[0]?.name || trip.destination || "Trip"
}

const yearOf = (date: string) => (date ? date.slice(0, 4) : undefined)

function perPersonOf(s: SavedTrip) {
  const places = new Map(s.places.map((p) => [p.id, p]))
  const days = buildDays(s.trip, s.itinerary)
  const { shown, edited } = withVoiceChanges(days, places, s.overrides)
  return {
    total: planTotals(days, shown, edited, s.itinerary).total,
    days: shown.length || daysBetween(s.trip.startDate, s.trip.endDate),
  }
}

type When = ReturnType<typeof countdown>

/** Short label for trips further off: "3 weeks", "4 months"; close ones keep "5 days to go". */
function shortCountdown(when: When) {
  if (!when) return null
  if (when.days >= 60) return `${Math.round(when.days / 30)} months`
  if (when.days >= 14) return `${Math.round(when.days / 7)} weeks`
  return when.text
}

export default function HomePage() {
  const router = useRouter()
  const [saved, setSaved] = useState<SavedTrip[]>([])
  const [draft, setDraft] = useState<Trip | null>(null)
  const [showPast, setShowPast] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      const list = withColours(listSaved())
      setSaved(list)
      const t = loadTrip()
      // A trip in progress that isn't already in My trips.
      setDraft(t.stops.length && !list.some((s) => s.id === t.id) ? t : null)
    })
  }, [])

  // Soonest trip first; finished trips at the end.
  const ordered = saved
    .map((s) => ({ s, when: countdown(s.trip.startDate, s.trip.endDate) }))
    .sort((a, b) => {
      const pa = a.when?.past ? 1 : 0
      const pb = b.when?.past ? 1 : 0
      if (pa !== pb) return pa - pb
      return pa
        ? b.s.trip.startDate.localeCompare(a.s.trip.startDate)
        : a.s.trip.startDate.localeCompare(b.s.trip.startDate)
    })
  const upcoming = ordered.filter((o) => !o.when?.past)
  const past = ordered.filter((o) => o.when?.past)
  const next = upcoming[0]
  const later = upcoming.slice(1)

  const card = ({ s, when }: (typeof ordered)[number]) => {
    const { total, days } = perPersonOf(s)
    const label = when && !when.past ? shortCountdown(when) : null
    return (
      <li key={s.id}>
        <Link
          href={`/trips/${encodeURIComponent(s.id)}`}
          className={`flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-foreground/10 transition-colors hover:bg-muted ${
            when?.past ? "opacity-80" : ""
          }`}
        >
          <TripStamp trip={s.trip} city={cityOf(s.trip)} year={yearOf(s.trip.startDate)} colour={s.colour} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate font-medium" title={s.trip.destination || cityOf(s.trip)}>
                {s.trip.destination || cityOf(s.trip)}
              </p>
              {label ? (
                <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-secondary-foreground">
                  {label}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {dateRange(s.trip.startDate, s.trip.endDate)}, {days} {days === 1 ? "day" : "days"}
            </p>
            {SHOW_COSTS && total ? (
              <p className="text-sm font-medium tabular-nums">{formatMoney(total)} per person</p>
            ) : null}
          </div>
        </Link>
      </li>
    )
  }

  // ---- next trip (hero) ----
  const hero = (() => {
    if (!next) return null
    const { s, when } = next
    const colour = s.colour ?? tripColour(s.trip.id)
    const { total, days } = perPersonOf(s)
    const now = !when || when.days <= 0
    // Whole-trip cost against the budget, when both are in the same currency.
    const budget = s.trip.budget
    const group = total ? total.amount * Math.max(1, s.trip.travellers) : null
    const showBudget =
      SHOW_COSTS && total && group !== null && budget.amount && budget.currency === total.currency
    const used = showBudget ? Math.min(1, group! / budget.amount!) : 0
    const over = showBudget && group! > budget.amount!
    return (
      <section className="mb-8" aria-label="Your next trip">
        <Link
          href={`/trips/${encodeURIComponent(s.id)}`}
          className="block rounded-3xl bg-card p-4 ring-2 transition-colors hover:bg-muted"
          style={{ ["--tw-ring-color" as string]: colour }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium" style={{ color: colour }}>
                {now ? "Happening now" : "Your next trip"}
              </p>
              <p className="mt-0.5 truncate text-xl leading-tight font-semibold" title={s.trip.destination || cityOf(s.trip)}>
                {s.trip.destination || cityOf(s.trip)}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {dateRange(s.trip.startDate, s.trip.endDate)} · {days} {days === 1 ? "day" : "days"}
              </p>
              {!now ? (
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-5xl leading-none font-semibold tabular-nums" style={{ color: colour }}>
                    {when!.days}
                  </span>
                  <span className="text-muted-foreground">{when!.days === 1 ? "day to go" : "days to go"}</span>
                </p>
              ) : null}
            </div>
            <TripStamp
              trip={s.trip}
              city={cityOf(s.trip)}
              year={yearOf(s.trip.startDate)}
              colour={colour}
              className="size-[88px]"
            />
          </div>

          {showBudget ? (
            <div className="mt-4">
              <div
                className="h-1.5 overflow-hidden rounded-full"
                style={{ backgroundColor: `${colour}26` }}
                role="meter"
                aria-label="Budget used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(used * 100)}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${used * 100}%`, backgroundColor: over ? "var(--destructive)" : colour }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                <span className={over ? "font-medium text-destructive" : "text-muted-foreground"}>
                  {formatMoney({ amount: group!, currency: total!.currency })} of{" "}
                  {formatMoney({ amount: budget.amount!, currency: budget.currency })} budget
                </span>
                <span className="inline-flex items-center gap-1 font-medium" style={{ color: colour }}>
                  Open plan <ArrowRight className="size-3.5" />
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {SHOW_COSTS && total ? `${formatMoney(total)} per person` : ""}
              </span>
              <span className="inline-flex items-center gap-1 font-medium" style={{ color: colour }}>
                Open plan <ArrowRight className="size-3.5" />
              </span>
            </div>
          )}
        </Link>
      </section>
    )
  })()

  const createNew = () => {
    startNewTrip()
    router.push("/plan")
  }

  return (
    <>
      <Splash />
      <div className="mx-auto flex min-h-svh w-full max-w-md flex-col px-4 pt-4 pb-10">
        <header className="mb-8">
          <Brand />
        </header>

        {hero}

        <section className="mb-8">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">Where to next?</h1>
          <p className="mt-2 text-muted-foreground">
            Plan a trip around the things you love, day by day, with the costs worked out.
          </p>
          <Button
            size="lg"
            className="mt-5 h-14 w-full text-base shadow-[0_10px_24px_-12px_rgba(0,110,80,0.6)]"
            onClick={createNew}
          >
            <Plus className="size-5" /> Create a new holiday
          </Button>
        </section>

        {draft ? (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Still planning</h2>
            <Link
              href={isServerTrip(draft.id) ? "/itinerary" : "/plan"}
              className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-foreground/10 transition-colors hover:bg-muted"
            >
              <TripStamp
                trip={draft}
                city={cityOf(draft)}
                year={yearOf(draft.startDate)}
                colour={PALETTE.find((c) => !saved.some((s) => s.colour === c))}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" title={draft.destination || summarise(draft.stops) || "Your trip"}>
                  {draft.destination || summarise(draft.stops) || "Your trip"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {draft.startDate && draft.endDate
                    ? `${dateRange(draft.startDate, draft.endDate)}, ${daysBetween(draft.startDate, draft.endDate)} days`
                    : "No dates yet"}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                Continue <ArrowRight className="size-4" />
              </span>
            </Link>
          </section>
        ) : null}

        {next ? (
          later.length ? (
            <section aria-labelledby="upcoming-heading">
              <h2 id="upcoming-heading" className="mb-3 text-lg font-semibold">
                Also coming up
                <span className="ml-1.5 font-normal text-muted-foreground">{later.length}</span>
              </h2>
              <ul className="flex flex-col gap-3">{later.map(card)}</ul>
            </section>
          ) : null
        ) : (
          <section aria-labelledby="upcoming-heading">
            <h2 id="upcoming-heading" className="mb-3 text-lg font-semibold">
              Upcoming
            </h2>
            <div className="rounded-2xl border border-dashed border-foreground/15 p-6 text-center text-sm text-muted-foreground">
              {saved.length ? (
                <>
                  No upcoming trips yet. Tap <span className="font-medium text-foreground">Create a new holiday</span> to
                  plan your next one.
                </>
              ) : (
                <>
                  Finished plans show up here. When your plan is ready, tap{" "}
                  <span className="font-medium text-foreground">Save to my trips</span> on the final page.
                </>
              )}
            </div>
          </section>
        )}

        <section className="mt-8" aria-labelledby="past-heading">
          <button
            id="past-heading"
            onClick={() => setShowPast((v) => !v)}
            aria-expanded={showPast}
            aria-controls="past-trips"
            className="mb-3 flex w-full items-center justify-between rounded-lg text-left text-lg font-semibold"
          >
            <span>
              Past trips{" "}
              {past.length ? <span className="ml-1 font-normal text-muted-foreground">{past.length}</span> : null}
            </span>
            <ChevronDown
              className={`size-5 text-muted-foreground transition-transform ${showPast ? "rotate-180" : ""}`}
            />
          </button>
          {showPast ? (
            past.length ? (
              <ul id="past-trips" className="flex flex-col gap-3">
                {past.map(card)}
              </ul>
            ) : (
              <p
                id="past-trips"
                className="rounded-2xl border border-dashed border-foreground/15 p-5 text-center text-sm text-muted-foreground"
              >
                No past trips yet. Trips move here once they’re over.
              </p>
            )
          ) : null}
        </section>
      </div>
    </>
  )
}
