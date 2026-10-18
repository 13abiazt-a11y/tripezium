"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Check, Clapperboard, ImagePlus, Link2, Loader2, MapPin, Plus, Text } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageShell } from "@/components/page-shell"
import {
  getImportedPlaces,
  savePlaces,
  startLinkImport,
  startScreenshotImport,
  startTextImport,
  syncTrip,
  waitForImport,
} from "@/lib/api"
import { loadTrip } from "@/lib/trip-store"
import type { Place } from "@/lib/types"

type Mode = "link" | "text" | "screens"

const MODES: { id: Mode; label: string; icon: typeof Link2 }[] = [
  { id: "link", label: "Link", icon: Link2 },
  { id: "text", label: "Caption", icon: Text },
  { id: "screens", label: "Screenshots", icon: ImagePlus },
]

const WORKING: Record<Mode, string> = {
  link: "Watching the video for places…",
  text: "Reading the caption for places…",
  screens: "Looking through your screenshots…",
}

const MAX_SCREENSHOTS = 10

function PlaceRow({ place, picked, onToggle }: { place: Place; picked?: boolean; onToggle?: () => void }) {
  const body = (
    <>
      <span
        aria-hidden
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border ${
          picked ? "border-primary bg-primary text-primary-foreground" : "border-border"
        }`}
      >
        {picked ? <Check className="size-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block font-medium">{place.nameEnglish}</span>
            {place.name !== place.nameEnglish ? <span className="block text-xs text-muted-foreground">{place.name}</span> : null}
          </span>
          {place.category ? <Badge variant="secondary" className="shrink-0 capitalize">{place.category}</Badge> : null}
        </span>
        {place.tip ? <span className="mt-1 block text-xs text-muted-foreground">{place.tip}</span> : null}
        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {place.lat === null ? (
            <span className="inline-flex items-center gap-1"><MapPin className="size-3" /> We’ll find it on the map</span>
          ) : null}
          {place.timestamp && place.sourceUrl ? <span>At {place.timestamp} in the video</span> : null}
        </span>
      </span>
    </>
  )
  return onToggle ? (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!picked}
      onClick={onToggle}
      className="flex w-full items-start gap-3 rounded-xl bg-card p-3 text-left text-sm ring-1 ring-foreground/10 hover:bg-muted"
    >
      {body}
    </button>
  ) : (
    <div className="flex w-full items-start gap-3 rounded-xl bg-card p-3 text-sm ring-1 ring-foreground/10">{body}</div>
  )
}

export default function ImportPage() {
  const [tripId, setTripId] = useState<string | null>(null)
  const [noTrip, setNoTrip] = useState(false)
  const [saved, setSaved] = useState<Place[]>([])
  const [mode, setMode] = useState<Mode>("link")
  const [link, setLink] = useState("")
  const [text, setText] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [review, setReview] = useState<{ places: Place[]; message: string | null } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      const t = loadTrip()
      if (!t.stops.length || !t.startDate) return setNoTrip(true)
      try {
        const synced = await syncTrip(t) // usually already created by the interests step
        setTripId(synced.id)
        setSaved(await getImportedPlaces(synced.id))
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load your trip.")
      }
    })()
  }, [])

  const ready =
    !!tripId && !working && (mode === "link" ? !!link.trim() : mode === "text" ? !!text.trim() : files.length > 0)

  async function findPlaces() {
    if (!tripId) return
    setWorking(true)
    setError("")
    setReview(null)
    try {
      const job =
        mode === "link"
          ? await startLinkImport(link.trim(), tripId)
          : mode === "text"
            ? await startTextImport(text.trim(), tripId)
            : await startScreenshotImport(files, tripId)
      const result = await waitForImport(job)
      const known = new Set(saved.map((p) => p.nameEnglish.toLowerCase()))
      const fresh = result.places.filter((p) => !known.has(p.nameEnglish.toLowerCase()))
      setReview({ places: fresh, message: result.message })
      setPicked(new Set(fresh.map((p) => p.id))) // all ticked: untick what you don't want
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.")
    } finally {
      setWorking(false)
    }
  }

  async function addPicked() {
    if (!tripId || !review) return
    setAdding(true)
    setError("")
    try {
      const added = await savePlaces(tripId, review.places.filter((p) => picked.has(p.id)))
      setSaved((s) => [...s, ...added])
      setReview(null)
      setLink("")
      setText("")
      setFiles([])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save those places. Please try again.")
    } finally {
      setAdding(false)
    }
  }

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (noTrip) {
    return (
      <PageShell step={3} back="/interests" title="Add video ideas">
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Start by telling us where you’re going.{" "}
          <Link href="/plan" className="font-medium text-primary underline-offset-4 hover:underline">
            Plan your trip
          </Link>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      step={3}
      back="/interests"
      title="Add video ideas"
      subtitle="Paste a YouTube or TikTok link and we'll pull out the places."
      footer={
        <Link href="/itinerary" className={buttonVariants({ size: "lg", className: "h-12 w-full text-base" })}>
          {saved.length
            ? `Build my itinerary with ${saved.length} ${saved.length === 1 ? "place" : "places"}`
            : "Skip and build my itinerary"}
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex gap-2" role="tablist" aria-label="How to add places">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => {
                setMode(id)
                setError("")
              }}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                mode === id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
              }`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        {mode === "link" ? (
          <div className="relative">
            <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="YouTube or TikTok link"
              placeholder="https://www.tiktok.com/… or youtube.com/…"
              className="h-11 pl-9"
              inputMode="url"
              autoComplete="off"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready) findPlaces()
              }}
            />
          </div>
        ) : mode === "text" ? (
          <textarea
            aria-label="Caption or text that mentions places"
            placeholder="Paste the video's caption, or any text that mentions places"
            rows={5}
            maxLength={10000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        ) : (
          <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground hover:bg-muted">
            <ImagePlus className="size-5 text-primary" />
            {files.length ? (
              <span className="font-medium text-foreground">
                {files.length} screenshot{files.length === 1 ? "" : "s"} chosen
              </span>
            ) : (
              <span>Choose up to {MAX_SCREENSHOTS} screenshots, e.g. every slide of a TikTok slideshow</span>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              className="sr-only"
              onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, MAX_SCREENSHOTS))}
            />
          </label>
        )}

        <Button size="lg" variant="outline" className="h-11" disabled={!ready} onClick={findPlaces}>
          {working ? (
            <>
              <Loader2 className="animate-spin" /> {WORKING[mode]}
            </>
          ) : (
            <>
              <Clapperboard /> Find places
            </>
          )}
        </Button>
        {working ? (
          <p className="-mt-3 text-center text-xs text-muted-foreground">This can take a minute for longer videos.</p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {review ? (
          <section className="flex flex-col gap-2.5">
            <h2 className="text-sm font-medium">
              {review.places.length
                ? `Found ${review.places.length} ${review.places.length === 1 ? "place" : "places"}. Untick any you don’t want.`
                : "Nothing new: you’ve already added every place from that."}
            </h2>
            {review.message ? <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-secondary-foreground">{review.message}</p> : null}
            {review.places.map((p) => (
              <PlaceRow key={p.id} place={p} picked={picked.has(p.id)} onToggle={() => toggle(p.id)} />
            ))}
            {review.places.length ? (
              <div className="flex gap-2">
                <Button className="h-11 flex-1" disabled={!picked.size || adding} onClick={addPicked}>
                  {adding ? <Loader2 className="animate-spin" /> : <Plus />}
                  Add {picked.size} to my trip
                </Button>
                <Button variant="ghost" className="h-11" onClick={() => setReview(null)}>
                  Discard
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {saved.length ? (
          <section className="flex flex-col gap-2.5">
            <h2 className="text-sm font-medium">Your places ({saved.length})</h2>
            {saved.map((p) => (
              <PlaceRow key={p.id} place={p} picked />
            ))}
          </section>
        ) : null}
      </div>
    </PageShell>
  )
}
