"use client"

// A trip saved to the home page. Opens from the saved snapshot (instant, works
// offline). "Edit plan" loads it back into the planner.
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { ChevronLeft, Pencil, Printer, Trash2 } from "lucide-react"

import { Brand } from "@/components/brand"
import { FinalPlan } from "@/components/final-plan"
import { Button, buttonVariants } from "@/components/ui/button"
import { deleteSaved, getSaved, type SavedTrip } from "@/lib/saved-trips"
import { saveTrip } from "@/lib/trip-store"
import { saveOverrides } from "@/lib/voice-edits"

export default function SavedTripPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [entry, setEntry] = useState<SavedTrip | null | undefined>(undefined) // undefined = loading
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    queueMicrotask(() => setEntry(getSaved(decodeURIComponent(id))))
  }, [id])

  const edit = () => {
    if (!entry) return
    saveTrip(entry.trip) // make it the trip being planned
    saveOverrides(entry.id, entry.overrides)
    router.push("/itinerary")
  }

  const remove = () => {
    if (!entry) return
    if (!confirmDelete) return setConfirmDelete(true)
    deleteSaved(entry.id)
    router.push("/")
  }

  const editable = !!entry?.trip.stops.length // the demo trip can't be edited

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col px-4 pt-4 pb-10">
      <header className="mb-5 flex items-center justify-between gap-3 print:hidden">
        <Link href="/" className="-ml-2 inline-flex items-center gap-1 rounded-lg p-1.5 hover:bg-muted" aria-label="Back to My trips">
          <ChevronLeft className="size-5" />
          <Brand />
        </Link>
        {entry && editable ? (
          <Button variant="outline" className="h-10 bg-card px-3" onClick={edit}>
            <Pencil /> Edit plan
          </Button>
        ) : null}
      </header>

      {entry === undefined ? (
        <div className="h-44 animate-pulse rounded-2xl bg-primary/20" />
      ) : entry === null ? (
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10">
          <h1 className="text-xl font-semibold">We can’t find that trip</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Saved trips live in the browser they were saved in. It may have been deleted, or saved on another device.
          </p>
          <Link href="/" className={buttonVariants({ size: "lg", className: "mt-5 h-11 w-full" })}>
            Back to My trips
          </Link>
        </div>
      ) : (
        <FinalPlan
          trip={entry.trip}
          itinerary={entry.itinerary}
          places={new Map(entry.places.map((p) => [p.id, p]))}
          overrides={entry.overrides}
          kicker={`Saved ${new Date(entry.savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}
          actions={
            <>
              <Button variant="outline" size="lg" className="h-11 bg-card" onClick={() => window.print()}>
                <Printer /> Save as PDF
              </Button>
              {editable ? (
                <Button variant="ghost" size="lg" className="h-11" onClick={edit}>
                  <Pencil /> Make changes
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="lg"
                className="h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={remove}
                onBlur={() => setConfirmDelete(false)}
              >
                <Trash2 /> {confirmDelete ? "Tap again to delete this trip" : "Delete trip"}
              </Button>
            </>
          }
        />
      )}
    </div>
  )
}
