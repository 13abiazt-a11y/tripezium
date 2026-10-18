"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageShell } from "@/components/page-shell"
import { syncTrip } from "@/lib/api"
import { interestsFor, isPreset, type Interest } from "@/lib/interests"
import { daysBetween } from "@/lib/route"
import { loadTrip, saveTrip } from "@/lib/trip-store"
import type { CountryStop } from "@/lib/types"

const MAX_CUSTOM = 40 // characters

/**
 * How many interests fit the trip: a short trip can't do justice to ten themes,
 * and too many makes the plan try to cram everything in. 1 day → 3, 3 days → 5,
 * 5 days → 7, a week or more → up to 10.
 */
function maxInterests(days: number) {
  if (!days) return 10
  return Math.min(10, Math.max(3, days + 2))
}

function Chip({ interest, on, full, onClick }: { interest: Interest; on: boolean; full: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={full && !on}
      onClick={onClick}
      className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors active:scale-[0.98] ${
        on
          ? "border-primary bg-primary text-primary-foreground"
          : full
            ? "cursor-not-allowed border-border bg-card opacity-45"
            : "border-border bg-card hover:bg-muted"
      }`}
    >
      <span aria-hidden>{interest.emoji}</span>
      {interest.label}
      {on ? <Check className="size-4" /> : null}
    </button>
  )
}

export default function InterestsPage() {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [stops, setStops] = useState<CountryStop[]>([])
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [days, setDays] = useState(0)
  const [trimmed, setTrimmed] = useState(false) // we dropped some picks because the trip got shorter
  const [nudge, setNudge] = useState(false) // they tried to pick one more than allowed

  const { special, general, places } = interestsFor(stops)
  const custom = selected.filter((s) => !isPreset(s))
  const max = maxInterests(days)
  const full = selected.length >= max

  useEffect(() => {
    const t = loadTrip()
    const available = new Set([...interestsFor(t.stops).special, ...interestsFor(t.stops).general].map((x) => x.id))
    // Drop presets that no longer fit (e.g. temples after switching Japan → Italy); keep typed ones.
    const kept = t.interests.filter((x) => available.has(x) || !isPreset(x))
    const limit = maxInterests(daysBetween(t.startDate, t.endDate))
    setSelected(kept.slice(0, limit))
    setTrimmed(kept.length > limit)
    setDays(daysBetween(t.startDate, t.endDate))
    setStops(t.stops)
  }, [])

  const toggle = (id: string) => {
    if (!selected.includes(id) && full) {
      setNudge(true)
      return
    }
    setNudge(false)
    setTrimmed(false)
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function addCustom() {
    const text = draft.trim().replace(/\s+/g, " ").slice(0, MAX_CUSTOM)
    if (!text) return
    const match = [...special, ...general].find((x) => x.label.toLowerCase() === text.toLowerCase())
    const value = match ? match.id : text
    if (full && !selected.some((x) => x.toLowerCase() === value.toLowerCase())) {
      setNudge(true)
      return
    }
    setSelected((s) => (s.some((x) => x.toLowerCase() === value.toLowerCase()) ? s : [...s, value]))
    setDraft("")
  }

  async function next() {
    setSaving(true)
    setError("")
    try {
      // Create (or update) the trip on the server now, so imported places have a trip to belong to.
      await syncTrip(saveTrip({ interests: selected }))
      router.push("/import")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.")
      setSaving(false)
    }
  }

  return (
    <PageShell
      step={2}
      back="/plan"
      title="What are you into?"
      subtitle={`Pick up to ${max}${places ? ` for ${places}` : ""}, or add your own. You can skip this.`}
      footer={
        <div className="flex flex-col gap-2">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button size="lg" className="h-12 w-full text-base" onClick={next} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" /> Saving your trip…
              </>
            ) : selected.length ? (
              `Continue with ${selected.length}`
            ) : (
              "Skip for now"
            )}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <div
          aria-live="polite"
          className={`-mb-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 transition-colors ${
            nudge ? "bg-amber-50 text-amber-900 ring-amber-300" : "bg-card ring-foreground/10"
          }`}
        >
          <p>
            {nudge
              ? `That’s the most for ${days ? `a ${days}-day trip` : "one trip"}. Remove one to pick another.`
              : trimmed
                ? `Your trip got shorter, so we kept your first ${max}.`
                : days
                  ? `A ${days}-day trip has room for ${max} interests.`
                  : `Pick up to ${max} interests.`}
          </p>
          <span className="shrink-0 font-semibold tabular-nums" aria-label={`${selected.length} of ${max} picked`}>
            {selected.length}/{max}
          </span>
        </div>

        {special.length ? (
          <section className="flex flex-col gap-2.5">
            <h2 className="text-sm font-medium">Known for in {places}</h2>
            <div className="flex flex-wrap gap-2" role="group" aria-label={`Popular in ${places}`}>
              {special.map((x) => (
                <Chip key={x.id} interest={x} on={selected.includes(x.id)} full={full} onClick={() => toggle(x.id)} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2.5">
          {special.length ? <h2 className="text-sm font-medium">More ideas</h2> : null}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Interests">
            {general.map((x) => (
              <Chip key={x.id} interest={x} on={selected.includes(x.id)} full={full} onClick={() => toggle(x.id)} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="text-sm font-medium">Anything else?</h2>
          <p className="-mt-1.5 text-xs text-muted-foreground">
            Type a hobby or something you’d love to do, like “vintage shopping”, “rock climbing” or “vegan food”.
          </p>
          <div className="flex gap-2">
            <Input
              aria-label="Add your own interest"
              placeholder="Add your own"
              autoComplete="off"
              maxLength={MAX_CUSTOM}
              className="h-11"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addCustom()
                }
              }}
            />
            <Button type="button" variant="outline" className="h-11" disabled={!draft.trim() || full} onClick={addCustom}>
              <Plus /> Add
            </Button>
          </div>
          {custom.length ? (
            <div className="flex flex-wrap gap-2" aria-label="Your own interests">
              {custom.map((text) => (
                <span
                  key={text}
                  className="inline-flex h-11 items-center gap-1 rounded-full border border-primary bg-primary pr-1.5 pl-4 text-sm font-medium text-primary-foreground"
                >
                  {text}
                  <button
                    type="button"
                    aria-label={`Remove ${text}`}
                    onClick={() => toggle(text)}
                    className="grid size-8 place-items-center rounded-full hover:bg-primary-foreground/15"
                  >
                    <X className="size-4" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </PageShell>
  )
}
