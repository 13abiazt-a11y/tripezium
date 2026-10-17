"use client"

// "Been"-style picker: choose a country, tap the cities you're visiting,
// then add another country section and repeat. Order doesn't matter here —
// travel order is decided later on the itinerary page.
import { useState } from "react"
import { Check, Plus, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { countryName, flagOf, POPULAR, searchCountries, suggestedCities } from "@/lib/destinations"
import { newId } from "@/lib/route"
import type { CityStop, CountryStop } from "@/lib/types"

export function DestinationPicker({
  stops,
  onChange,
  datesPerCity,
  tripStart,
  tripEnd,
  errors,
}: {
  stops: CountryStop[]
  onChange: (stops: CountryStop[]) => void
  datesPerCity: boolean
  tripStart: string
  tripEnd: string
  errors: Record<string, string>
}) {
  // Always show at least one (empty) section so there's somewhere to start.
  const sections = stops.length ? stops : [{ id: "first", country: "", cities: [] }]
  const used = sections.map((s) => s.country).filter(Boolean)

  const update = (id: string, patch: Partial<CountryStop>) =>
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const remove = (id: string) => onChange(sections.filter((s) => s.id !== id))
  const add = () => onChange([...sections, { id: newId(), country: "", cities: [] }])

  const canAdd = sections.every((s) => s.country && s.cities.length)

  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) => (
        <CountrySection
          key={s.id}
          stop={s}
          exclude={used.filter((c) => c !== s.country)}
          onChange={(patch) => update(s.id, patch)}
          onRemove={sections.length > 1 || s.country ? () => remove(s.id) : undefined}
          datesPerCity={datesPerCity}
          tripStart={tripStart}
          tripEnd={tripEnd}
          errors={errors}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-11 border-dashed"
        disabled={!canAdd}
        onClick={add}
      >
        <Plus /> Add another country
      </Button>
    </div>
  )
}

function CountrySection({
  stop,
  exclude,
  onChange,
  onRemove,
  datesPerCity,
  tripStart,
  tripEnd,
  errors,
}: {
  stop: CountryStop
  exclude: string[]
  onChange: (patch: Partial<CountryStop>) => void
  onRemove?: () => void
  datesPerCity: boolean
  tripStart: string
  tripEnd: string
  errors: Record<string, string>
}) {
  if (!stop.country) {
    return (
      <div className="rounded-xl p-3 ring-1 ring-foreground/10">
        <CountrySearch exclude={exclude} onPick={(country) => onChange({ country, cities: [] })} onCancel={onRemove} />
        {errors[stop.id] ? <p className="mt-2 text-xs text-destructive">{errors[stop.id]}</p> : null}
      </div>
    )
  }

  const suggestions = suggestedCities(stop.country)
  const picked = new Set(stop.cities.map((c) => c.name))
  const custom = stop.cities.filter((c) => !suggestions.includes(c.name))

  const toggle = (name: string) =>
    onChange({
      cities: picked.has(name)
        ? stop.cities.filter((c) => c.name !== name)
        : [...stop.cities, { id: newId(), name }],
    })
  const setCity = (id: string, patch: Partial<CityStop>) =>
    onChange({ cities: stop.cities.map((c) => (c.id === id ? { ...c, ...patch } : c)) })

  return (
    <div className="rounded-xl p-3 ring-1 ring-foreground/10">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-2xl leading-none" aria-hidden>
          {flagOf(stop.country)}
        </span>
        <p className="flex-1 font-medium">{countryName(stop.country)}</p>
        {onRemove ? (
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${countryName(stop.country)}`} onClick={onRemove}>
            <X />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={`Cities in ${countryName(stop.country)}`}>
        {[...suggestions, ...custom.map((c) => c.name)].map((name) => {
          const on = picked.has(name)
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(name)}
              className={`inline-flex h-9 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors active:scale-[0.98] ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
              }`}
            >
              {name}
              {on ? <Check className="size-3.5" /> : null}
            </button>
          )
        })}
      </div>

      <AddCity
        hasSuggestions={suggestions.length > 0}
        onAdd={(name) => {
          const existing = [...suggestions, ...stop.cities.map((c) => c.name)].find(
            (c) => c.toLowerCase() === name.toLowerCase(),
          )
          if (existing) {
            if (!picked.has(existing)) toggle(existing)
          } else onChange({ cities: [...stop.cities, { id: newId(), name }] })
        }}
      />

      {datesPerCity && stop.cities.length ? (
        <div className="mt-3 flex flex-col gap-2 border-t pt-3">
          {stop.cities.map((c) => (
            <div key={c.id} className="flex flex-col gap-1">
              <span className="text-sm font-medium">{c.name}</span>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  aria-label={`${c.name} from`}
                  className="h-9 text-sm"
                  min={tripStart || undefined}
                  max={tripEnd || undefined}
                  value={c.startDate ?? ""}
                  aria-invalid={!!errors[c.id]}
                  onChange={(e) => {
                    const startDate = e.target.value
                    setCity(c.id, { startDate, endDate: !c.endDate || c.endDate < startDate ? startDate : c.endDate })
                  }}
                />
                <Input
                  type="date"
                  aria-label={`${c.name} to`}
                  className="h-9 text-sm"
                  min={c.startDate || tripStart || undefined}
                  max={tripEnd || undefined}
                  value={c.endDate ?? ""}
                  aria-invalid={!!errors[c.id]}
                  onChange={(e) => setCity(c.id, { endDate: e.target.value })}
                />
              </div>
              {errors[c.id] ? <p className="text-xs text-destructive">{errors[c.id]}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {errors[stop.id] ? <p className="mt-2 text-xs text-destructive">{errors[stop.id]}</p> : null}
    </div>
  )
}

function CountrySearch({
  exclude,
  onPick,
  onCancel,
}: {
  exclude: string[]
  onPick: (code: string) => void
  onCancel?: () => void
}) {
  const [q, setQ] = useState("")
  const results = searchCountries(q, exclude)
  const popular = POPULAR.filter((c) => !exclude.includes(c))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search for a country"
            aria-label="Search for a country"
            autoComplete="off"
            className="h-11 pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (results[0]) onPick(results[0].code)
              }
            }}
          />
        </div>
        {onCancel ? (
          <Button type="button" variant="ghost" size="icon" aria-label="Remove this country" onClick={onCancel}>
            <X />
          </Button>
        ) : null}
      </div>

      {q ? (
        results.length ? (
          <ul className="flex flex-col" role="listbox" aria-label="Countries">
            {results.map((c) => (
              <li key={c.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onPick(c.code)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-muted"
                >
                  <span className="text-xl leading-none" aria-hidden>
                    {c.flag}
                  </span>
                  <span className="text-sm font-medium">{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-2 text-sm text-muted-foreground">No country matches “{q}”.</p>
        )
      ) : (
        <div className="flex flex-wrap gap-2">
          {popular.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onPick(code)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              <span aria-hidden>{flagOf(code)}</span>
              {countryName(code)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddCity({ onAdd, hasSuggestions }: { onAdd: (name: string) => void; hasSuggestions: boolean }) {
  const [name, setName] = useState("")
  const submit = () => {
    const n = name.trim()
    if (n) onAdd(n)
    setName("")
  }
  return (
    <div className="mt-3 flex gap-2">
      <Input
        placeholder={hasSuggestions ? "Somewhere else? Type a city" : "Type a city"}
        aria-label="Add a city"
        autoComplete="off"
        className="h-9"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            submit()
          }
        }}
      />
      <Button type="button" variant="outline" className="h-9" disabled={!name.trim()} onClick={submit}>
        Add
      </Button>
    </div>
  )
}
