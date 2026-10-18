"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Minus, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DestinationPicker } from "@/components/destination-picker"
import { PageShell } from "@/components/page-shell"
import { CURRENCIES } from "@/lib/money"
import { daysBetween, summarise, syncRoute } from "@/lib/route"
import { emptyTrip, loadTrip, saveTrip } from "@/lib/trip-store"
import type { Trip } from "@/lib/types"

function Field({ label, htmlFor, children, error }: { label: string; htmlFor?: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

export default function TripFormPage() {
  const router = useRouter()
  const [trip, setTrip] = useState<Trip>(emptyTrip)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => setTrip(loadTrip()), [])

  const set = (patch: Partial<Trip>) => setTrip((t) => ({ ...t, ...patch }))
  const today = new Date().toISOString().slice(0, 10)
  const cityCount = trip.stops.reduce((n, s) => n + s.cities.length, 0)
  const exploreCount = trip.stops.filter((s) => s.country && !s.cities.length).length
  const placesLabel = [
    cityCount ? `${cityCount} ${cityCount === 1 ? "city" : "cities"}` : "",
    exploreCount ? `${exploreCount} ${exploreCount === 1 ? "country" : "countries"} to explore` : "",
  ]
    .filter(Boolean)
    .join(" + ")
  const tripDays = daysBetween(trip.startDate, trip.endDate)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    const stops = trip.stops.filter((s) => s.country) // drop empty sections

    if (!stops.length) errs.stops = "Where are you going? Pick a country."
    if (!trip.startDate) errs.startDate = "Pick a start date"
    if (!trip.endDate) errs.endDate = "Pick an end date"
    if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) errs.endDate = "End date is before the start date"
    if (trip.dayEnd <= trip.dayStart) errs.dayEnd = "Day should end after it starts"
    if (trip.budget.amount !== null && !(trip.budget.amount > 0)) errs.budget = "Enter a budget above 0, or leave it blank"

    if (trip.datesPerCity) {
      for (const c of stops.flatMap((s) => s.cities)) {
        if (!c.startDate || !c.endDate) errs[c.id] = "Add dates for this city"
        else if (c.endDate < c.startDate) errs[c.id] = "End date is before the start date"
        else if ((trip.startDate && c.startDate < trip.startDate) || (trip.endDate && c.endDate > trip.endDate))
          errs[c.id] = "These dates are outside your trip"
      }
    }

    setErrors(errs)
    if (Object.keys(errs).length) return

    const next: Trip = { ...trip, stops, destination: summarise(stops) }
    next.route = syncRoute(next, loadTrip())
    saveTrip(next)
    router.push("/interests")
  }

  return (
    <>
    <PageShell
      step={1}
      back="/"
      title="Plan your trip"
      subtitle="Tell us the basics. We'll build the days around you."
      footer={
        <Button type="submit" form="trip-form" size="lg" className="h-12 w-full text-base">
          Continue
        </Button>
      }
    >
      <form id="trip-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="start" error={errors.startDate}>
            <Input
              id="start"
              type="date"
              min={today}
              className="h-11"
              value={trip.startDate}
              aria-invalid={!!errors.startDate}
              onChange={(e) => {
                const startDate = e.target.value
                // Smart default: if no end date yet (or it's now before start), match it.
                set({ startDate, endDate: !trip.endDate || trip.endDate < startDate ? startDate : trip.endDate })
              }}
            />
          </Field>
          <Field label="To" htmlFor="end" error={errors.endDate}>
            <Input
              id="end"
              type="date"
              min={trip.startDate || today}
              className="h-11"
              value={trip.endDate}
              aria-invalid={!!errors.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">Where are you going?</p>
            {placesLabel ? (
              <p className="text-xs text-muted-foreground">
                {placesLabel}
                {tripDays ? ` · ${tripDays} ${tripDays === 1 ? "day" : "days"}` : ""}
              </p>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">Any order is fine. You can arrange your route later.</p>
          <div className="mt-1.5">
            <DestinationPicker
              stops={trip.stops}
              onChange={(stops) => set({ stops })}
              datesPerCity={trip.datesPerCity}
              tripStart={trip.startDate}
              tripEnd={trip.endDate}
              errors={errors}
            />
          </div>
          {errors.stops ? <p className="text-xs text-destructive">{errors.stops}</p> : null}
        </div>

        <label className="flex items-start gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-primary"
            checked={trip.datesPerCity}
            onChange={(e) => set({ datesPerCity: e.target.checked })}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">I know my dates for each city</span>
            <span className="text-xs text-muted-foreground">
              Leave this off and we’ll suggest how many days to spend in each place.
            </span>
          </span>
        </label>

        <Field label="Budget for the whole trip" htmlFor="budget" error={errors.budget}>
          <div className="flex gap-2">
            <select
              aria-label="Budget currency"
              className="h-11 rounded-lg border border-input bg-card px-2 text-sm font-medium"
              value={trip.budget.currency}
              onChange={(e) => set({ budget: { ...trip.budget, currency: e.target.value } })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Input
              id="budget"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="e.g. 1500"
              className="h-11 flex-1"
              value={trip.budget.amount ?? ""}
              aria-invalid={!!errors.budget}
              onChange={(e) =>
                set({ budget: { ...trip.budget, amount: e.target.value === "" ? null : Number(e.target.value) } })
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            For everyone travelling. Pick your home currency and we’ll keep suggestions in your range.
          </p>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start each day" htmlFor="dayStart">
            <Input id="dayStart" type="time" className="h-11" value={trip.dayStart} onChange={(e) => set({ dayStart: e.target.value })} />
          </Field>
          <Field label="Finish each day" htmlFor="dayEnd" error={errors.dayEnd}>
            <Input id="dayEnd" type="time" className="h-11" value={trip.dayEnd} aria-invalid={!!errors.dayEnd} onChange={(e) => set({ dayEnd: e.target.value })} />
          </Field>
        </div>

        <Field label="Travellers">
          <div className="flex items-center gap-4">
            <Button type="button" variant="outline" size="icon-lg" aria-label="Fewer travellers" disabled={trip.travellers <= 1} onClick={() => set({ travellers: trip.travellers - 1 })}>
              <Minus />
            </Button>
            <span className="w-6 text-center text-lg font-medium tabular-nums" aria-live="polite">
              {trip.travellers}
            </span>
            <Button type="button" variant="outline" size="icon-lg" aria-label="More travellers" disabled={trip.travellers >= 20} onClick={() => set({ travellers: trip.travellers + 1 })}>
              <Plus />
            </Button>
          </div>
        </Field>
      </form>
    </PageShell>
    </>
  )
}
