"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/page-shell"
import { loadTrip, saveTrip } from "@/lib/trip-store"

const INTERESTS = [
  { id: "food", label: "Food & drink", emoji: "🍜" },
  { id: "temples", label: "Temples & shrines", emoji: "⛩️" },
  { id: "landmarks", label: "Landmarks", emoji: "🗼" },
  { id: "museums", label: "Museums", emoji: "🏛️" },
  { id: "art", label: "Art", emoji: "🎨" },
  { id: "nature", label: "Nature & parks", emoji: "🌳" },
  { id: "beaches", label: "Beaches", emoji: "🏖️" },
  { id: "shopping", label: "Shopping", emoji: "🛍️" },
  { id: "markets", label: "Markets", emoji: "🧺" },
  { id: "nightlife", label: "Nightlife", emoji: "🌙" },
  { id: "hidden-gems", label: "Hidden gems", emoji: "💎" },
  { id: "photo-spots", label: "Photo spots", emoji: "📸" },
  { id: "family", label: "Family-friendly", emoji: "👨‍👩‍👧" },
  { id: "relaxed", label: "Slow & relaxed", emoji: "☕" },
]

export default function InterestsPage() {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [destination, setDestination] = useState("")

  useEffect(() => {
    const t = loadTrip()
    setSelected(t.interests)
    setDestination(t.destination)
  }, [])

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  function next() {
    saveTrip({ interests: selected })
    router.push("/import")
  }

  return (
    <PageShell
      step={2}
      back="/"
      title="What are you into?"
      subtitle={`Pick a few${destination ? ` for ${destination}` : ""}. You can skip this.`}
      footer={
        <Button size="lg" className="h-12 w-full text-base" onClick={next}>
          {selected.length ? `Continue with ${selected.length}` : "Skip for now"}
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Interests">
        {INTERESTS.map((i) => {
          const on = selected.includes(i.id)
          return (
            <button
              key={i.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(i.id)}
              className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors active:scale-[0.98] ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
              }`}
            >
              <span aria-hidden>{i.emoji}</span>
              {i.label}
              {on ? <Check className="size-4" /> : null}
            </button>
          )
        })}
      </div>
    </PageShell>
  )
}
