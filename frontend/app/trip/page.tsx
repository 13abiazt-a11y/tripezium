"use client"

// The plan you're working on, finalised: read-only and easy to scan.
// "Save to my trips" puts it on the home page; changes happen on /itinerary.
import Link from "next/link"
import { useEffect, useState } from "react"
import { BookmarkCheck, BookmarkPlus, Loader2, Pencil, Printer, RefreshCw } from "lucide-react"

import { Brand } from "@/components/brand"
import { FinalPlan } from "@/components/final-plan"
import { Button, buttonVariants } from "@/components/ui/button"
import { DEMO_TRIP_ID, getItinerary, getPlaces, getTrip, isServerTrip } from "@/lib/api"
import { getSaved, saveToMyTrips } from "@/lib/saved-trips"
import { loadTrip } from "@/lib/trip-store"
import type { Itinerary, Place, Trip } from "@/lib/types"
import { loadOverrides, type Overrides } from "@/lib/voice-edits"

type Phase = "loading" | "ready" | "not-planned" | "error"

export default function FinalPlanPage() {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [places, setPlaces] = useState<Place[]>([])
  const [overrides, setOverrides] = useState<Overrides>({})
  const [phase, setPhase] = useState<Phase>("loading")
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [saved, setSaved] = useState<"no" | "yes" | "failed">("no")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const local = loadTrip()
        let t: Trip
        if (local.stops.length && local.startDate) {
          if (!isServerTrip(local.id)) {
            if (!cancelled) setPhase("not-planned")
            return
          }
          t = local
        } else {
          t = await getTrip(DEMO_TRIP_ID) // nothing planned in this browser yet: the demo trip
        }
        const it = await getItinerary(t.id)
        if (!it) {
          if (!cancelled) setPhase("not-planned")
          return
        }
        const list = await getPlaces(t.id)
        if (cancelled) return
        const ov = loadOverrides(t.id)
        setTrip(t)
        setItinerary(it)
        setPlaces(list)
        setOverrides(ov)
        // Already in My trips and unchanged since? Show it as saved.
        const prev = getSaved(t.id)
        setSaved(prev && JSON.stringify(prev.itinerary) === JSON.stringify(it) && JSON.stringify(prev.overrides) === JSON.stringify(ov) ? "yes" : "no")
        setPhase("ready")
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "Something went wrong.")
        setPhase("error")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attempt])

  const save = () => {
    if (!trip || !itinerary) return
    setSaved(saveToMyTrips({ id: trip.id, trip, itinerary, places, overrides }) ? "yes" : "failed")
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col px-4 pt-4 pb-10">
      <header className="mb-5 flex items-center justify-between gap-3 print:hidden">
        <Link href="/" aria-label="Home" className="rounded-lg">
          <Brand />
        </Link>
        {phase === "ready" ? (
          <Link href="/itinerary" className={buttonVariants({ variant: "outline", className: "h-10 bg-card px-3" })}>
            <Pencil /> Edit plan
          </Link>
        ) : null}
      </header>

      {phase === "loading" ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <div className="h-44 animate-pulse rounded-2xl bg-primary/20" />
          <div className="h-56 animate-pulse rounded-xl bg-card" />
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your plan…
          </p>
        </div>
      ) : phase === "not-planned" ? (
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10">
          <h1 className="text-xl font-semibold">Your plan isn’t ready yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Finish planning on the itinerary page, then come back here to see the final version.
          </p>
          <Link href="/itinerary" className={buttonVariants({ size: "lg", className: "mt-5 h-11 w-full" })}>
            Go to my itinerary
          </Link>
        </div>
      ) : phase === "error" ? (
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => (setPhase("loading"), setAttempt((n) => n + 1))}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : trip && itinerary ? (
        <FinalPlan
          trip={trip}
          itinerary={itinerary}
          places={new Map(places.map((p) => [p.id, p]))}
          overrides={overrides}
          actions={
            <>
              {saved === "yes" ? (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-primary/40">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <BookmarkCheck className="size-4 text-primary" /> Saved to My trips
                  </span>
                  <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
                    Go to My trips
                  </Link>
                </div>
              ) : (
                <Button size="lg" className="h-12 text-base" onClick={save}>
                  <BookmarkPlus /> Save to my trips
                </Button>
              )}
              {saved === "failed" ? (
                <p role="alert" className="text-sm text-destructive">
                  This browser wouldn’t save the trip. Free up space by deleting an old trip, then try again.
                </p>
              ) : null}
              <Button variant="outline" size="lg" className="h-11 bg-card" onClick={() => window.print()}>
                <Printer /> Save as PDF
              </Button>
              <Link href="/itinerary" className={buttonVariants({ variant: "ghost", size: "lg", className: "h-11" })}>
                <Pencil /> Make changes
              </Link>
            </>
          }
        />
      ) : null}
    </div>
  )
}
