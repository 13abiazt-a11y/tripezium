"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageShell } from "@/components/page-shell"
import { interestsFor, isPreset, type Interest } from "@/lib/interests"
import { loadTrip, saveTrip } from "@/lib/trip-store"
import type { CountryStop } from "@/lib/types"

const MAX_CUSTOM = 40 // characters

function Chip({ interest, on, onClick }: { interest: Interest; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors active:scale-[0.98] ${
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
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

  const { special, general, places } = interestsFor(stops)
  const custom = selected.filter((s) => !isPreset(s))

  useEffect(() => {
    const t = loadTrip()
    const available = new Set([...interestsFor(t.stops).special, ...interestsFor(t.stops).general].map((x) => x.id))
    // Drop presets that no longer fit (e.g. temples after switching Japan → Italy); keep typed ones.
    setSelected(t.interests.filter((x) => available.has(x) || !isPreset(x)))
    setStops(t.stops)
  }, [])

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  function addCustom() {
    const text = draft.trim().replace(/\s+/g, " ").slice(0, MAX_CUSTOM)
    if (!text) return
    const match = [...special, ...general].find((x) => x.label.toLowerCase() === text.toLowerCase())
    const value = match ? match.id : text
    setSelected((s) => (s.some((x) => x.toLowerCase() === value.toLowerCase()) ? s : [...s, value]))
    setDraft("")
  }

  function next() {
    saveTrip({ interests: selected })
    router.push("/import")
  }

  return (
    <PageShell
      step={2}
      back="/"
      title="What are you into?"
      subtitle={`Pick a few${places ? ` for ${places}` : ""}, or add your own. You can skip this.`}
      footer={
        <Button size="lg" className="h-12 w-full text-base" onClick={next}>
          {selected.length ? `Continue with ${selected.length}` : "Skip for now"}
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {special.length ? (
          <section className="flex flex-col gap-2.5">
            <h2 className="text-sm font-medium">Known for in {places}</h2>
            <div className="flex flex-wrap gap-2" role="group" aria-label={`Popular in ${places}`}>
              {special.map((x) => (
                <Chip key={x.id} interest={x} on={selected.includes(x.id)} onClick={() => toggle(x.id)} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2.5">
          {special.length ? <h2 className="text-sm font-medium">More ideas</h2> : null}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Interests">
            {general.map((x) => (
              <Chip key={x.id} interest={x} on={selected.includes(x.id)} onClick={() => toggle(x.id)} />
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
            <Button type="button" variant="outline" className="h-11" disabled={!draft.trim()} onClick={addCustom}>
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
