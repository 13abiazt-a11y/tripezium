"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Minus, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageShell } from "@/components/page-shell"
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

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!trip.destination.trim()) errs.destination = "Where are you going?"
    if (!trip.startDate) errs.startDate = "Pick a start date"
    if (!trip.endDate) errs.endDate = "Pick an end date"
    if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) errs.endDate = "End date is before the start date"
    if (trip.dayEnd <= trip.dayStart) errs.dayEnd = "Day should end after it starts"
    setErrors(errs)
    if (Object.keys(errs).length) return
    saveTrip({ ...trip, destination: trip.destination.trim() })
    router.push("/interests")
  }

  return (
    <PageShell
      step={1}
      title="Plan your trip"
      subtitle="Tell us the basics. We'll build the days around you."
      footer={
        <Button type="submit" form="trip-form" size="lg" className="h-12 w-full text-base">
          Continue
        </Button>
      }
    >
      <form id="trip-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Destination" htmlFor="destination" error={errors.destination}>
          <Input
            id="destination"
            placeholder="e.g. Tokyo"
            autoComplete="off"
            className="h-11"
            value={trip.destination}
            aria-invalid={!!errors.destination}
            onChange={(e) => set({ destination: e.target.value })}
          />
        </Field>

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
  )
}
