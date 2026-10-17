"use client"

import { useEffect, useMemo, useState } from "react"
import { Clock, Lightbulb, MapPin } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { PageShell } from "@/components/page-shell"
import { mockItinerary, mockPlaces, mockTrip } from "@/lib/mock"
import { loadTrip } from "@/lib/trip-store"
import type { ItineraryDay, Place, Trip } from "@/lib/types"

function formatDay(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ")
}

export default function ItineraryPage() {
  // TODO(A+C): replace mocks with GET /trips/{id}/itinerary
  const [trip, setTrip] = useState<Trip>(mockTrip)
  const days: ItineraryDay[] = mockItinerary
  const places = useMemo(() => new Map<string, Place>(mockPlaces.map((p) => [p.id, p])), [])
  const [active, setActive] = useState(0)

  useEffect(() => {
    const t = loadTrip()
    if (t.destination) setTrip(t)
  }, [])

  const day = days[active]

  return (
    <PageShell
      step={4}
      back="/import"
      title={`${trip.destination || "Your"} itinerary`}
      subtitle={`${days.length} days · ${trip.travellers} ${trip.travellers === 1 ? "traveller" : "travellers"}`}
    >
      {/* Map goes here (B: Leaflet) */}
      <div className="mb-4 flex h-40 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
        <MapPin className="mr-1.5 size-4" /> Map
      </div>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {days.map((d, i) => (
          <button
            key={d.date}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              i === active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
            }`}
          >
            Day {i + 1} <span className="opacity-70">· {formatDay(d.date)}</span>
          </button>
        ))}
      </div>

      {day && day.items.length ? (
        <ol className="relative flex flex-col gap-3 border-l border-border pl-5">
          {day.items.map((item) => {
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
                    {p ? <Badge variant="secondary" className="capitalize">{p.category}</Badge> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{formatDuration(item.durationMins)}</span>
                    {item.note ? <span>{item.note}</span> : null}
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
          Nothing planned for this day yet.
        </div>
      )}
    </PageShell>
  )
}
