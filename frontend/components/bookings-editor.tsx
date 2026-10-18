"use client"

// The traveller's own bookings on the itinerary page, all optional: where they're staying, and
// flights / trains / buses they've booked (the way in, the way home, or between cities).
// Changing them asks to update the plan, like changing the route.
import { useState } from "react"
import { BedDouble, ChevronDown, Pencil, Plane, Plus, TrainFront, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { describeJourney, JOURNEY_KINDS, kindLabel, sortJourneys, sortStays } from "@/lib/bookings"
import type { Journey, JourneyKind, Stay } from "@/lib/types"

type Editing = { type: "stay"; index: number | null } | { type: "journey"; index: number | null } | null

const label = "mb-1 block text-xs font-medium text-muted-foreground"

export function BookingsEditor({
  stays,
  transport,
  startDate,
  endDate,
  readOnly,
  onChange,
}: {
  stays: Stay[]
  transport: Journey[]
  startDate: string
  endDate: string
  readOnly?: boolean
  onChange: (patch: { stays?: Stay[]; transport?: Journey[] }) => void
}) {
  const count = stays.length + transport.length
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  if (readOnly && !count) return null

  const saveStay = (s: Stay, index: number | null) => {
    const next = index === null ? [...stays, s] : stays.map((x, i) => (i === index ? s : x))
    onChange({ stays: sortStays(next) })
    setEditing(null)
  }
  const saveJourney = (j: Journey, index: number | null) => {
    const next = index === null ? [...transport, j] : transport.map((x, i) => (i === index ? j : x))
    onChange({ transport: sortJourneys(next) })
    setEditing(null)
  }

  return (
    <section className="mb-5 rounded-xl p-3 ring-1 ring-foreground/10" aria-label="Your bookings">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>
          <span className="font-medium">Your bookings</span>
          <span className="ml-1.5 text-xs text-muted-foreground">
            {count ? `${stays.length} ${stays.length === 1 ? "stay" : "stays"} · ${transport.length} travel` : "optional"}
          </span>
        </span>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="mt-3 flex flex-col gap-4">
          {!readOnly ? (
            <p className="text-xs text-muted-foreground">
              Add where you’re staying and any flights or trains you’ve booked, including between cities. We’ll plan
              around them.
            </p>
          ) : null}

          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <BedDouble className="size-4 text-primary" /> Where you’re staying
            </h3>
            <ul className="flex flex-col gap-2">
              {stays.map((s, i) =>
                editing?.type === "stay" && editing.index === i ? (
                  <li key={i}>
                    <StayForm initial={s} startDate={startDate} endDate={endDate} onSave={(x) => saveStay(x, i)} onCancel={() => setEditing(null)} />
                  </li>
                ) : (
                  <Row
                    key={i}
                    title={s.name}
                    detail={`${s.checkIn} → ${s.checkOut}${s.city ? ` · ${s.city}` : ""}${s.address ? ` · ${s.address}` : ""}`}
                    readOnly={readOnly}
                    onEdit={() => setEditing({ type: "stay", index: i })}
                    onRemove={() => onChange({ stays: stays.filter((_, j) => j !== i) })}
                  />
                ),
              )}
            </ul>
            {!readOnly && editing?.type === "stay" && editing.index === null ? (
              <StayForm startDate={startDate} endDate={endDate} onSave={(x) => saveStay(x, null)} onCancel={() => setEditing(null)} />
            ) : !readOnly ? (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setEditing({ type: "stay", index: null })}>
                <Plus /> Add a stay
              </Button>
            ) : null}
          </div>

          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Plane className="size-4 text-primary" /> Flights, trains and other travel
            </h3>
            <ul className="flex flex-col gap-2">
              {transport.map((j, i) =>
                editing?.type === "journey" && editing.index === i ? (
                  <li key={i}>
                    <JourneyForm initial={j} startDate={startDate} onSave={(x) => saveJourney(x, i)} onCancel={() => setEditing(null)} />
                  </li>
                ) : (
                  <Row
                    key={i}
                    title={`${kindLabel(j.kind)}${j.reference ? ` ${j.reference}` : ""}`}
                    detail={`${j.departs.slice(0, 10)} · ${describeJourney(j)}`}
                    readOnly={readOnly}
                    onEdit={() => setEditing({ type: "journey", index: i })}
                    onRemove={() => onChange({ transport: transport.filter((_, k) => k !== i) })}
                  />
                ),
              )}
            </ul>
            {!readOnly && editing?.type === "journey" && editing.index === null ? (
              <JourneyForm startDate={startDate} onSave={(x) => saveJourney(x, null)} onCancel={() => setEditing(null)} />
            ) : !readOnly ? (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setEditing({ type: "journey", index: null })}>
                <TrainFront /> Add a flight or train
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function Row({
  title,
  detail,
  readOnly,
  onEdit,
  onRemove,
}: {
  title: string
  detail: string
  readOnly?: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg bg-card py-1.5 pr-1.5 pl-3 ring-1 ring-foreground/10">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      {!readOnly ? (
        <>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${title}`} onClick={onEdit}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${title}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        </>
      ) : null}
    </li>
  )
}

function StayForm({
  initial,
  startDate,
  endDate,
  onSave,
  onCancel,
}: {
  initial?: Stay
  startDate: string
  endDate: string
  onSave: (s: Stay) => void
  onCancel: () => void
}) {
  const [s, setS] = useState<Stay>(initial ?? { name: "", address: "", city: "", checkIn: startDate, checkOut: endDate })
  const valid = s.name.trim() && s.checkIn && s.checkOut && s.checkOut >= s.checkIn
  const moved = initial && (initial.name !== s.name || initial.address !== s.address || initial.city !== s.city)
  return (
    <form
      className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        // New name or address: let the server find it again.
        onSave({ ...s, name: s.name.trim(), address: s.address?.trim() || null, city: s.city?.trim() || null, ...(moved ? { lat: null, lng: null } : {}) })
      }}
    >
      <label className="col-span-2">
        <span className={label}>Name</span>
        <Input required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Hotel Gracery Shinjuku" maxLength={200} />
      </label>
      <label>
        <span className={label}>City</span>
        <Input value={s.city ?? ""} onChange={(e) => setS({ ...s, city: e.target.value })} placeholder="Tokyo" maxLength={100} />
      </label>
      <label>
        <span className={label}>Address (optional)</span>
        <Input value={s.address ?? ""} onChange={(e) => setS({ ...s, address: e.target.value })} maxLength={300} />
      </label>
      <label>
        <span className={label}>Check in</span>
        <Input type="date" required value={s.checkIn} onChange={(e) => setS({ ...s, checkIn: e.target.value })} />
      </label>
      <label>
        <span className={label}>Check out</span>
        <Input type="date" required value={s.checkOut} min={s.checkIn} onChange={(e) => setS({ ...s, checkOut: e.target.value })} />
      </label>
      <FormButtons valid={!!valid} onCancel={onCancel} />
    </form>
  )
}

function JourneyForm({
  initial,
  startDate,
  onSave,
  onCancel,
}: {
  initial?: Journey
  startDate: string
  onSave: (j: Journey) => void
  onCancel: () => void
}) {
  const [j, setJ] = useState<Journey>(
    initial ?? { kind: "flight", origin: "", destination: "", departs: `${startDate}T09:00`, arrives: "", reference: "" },
  )
  const valid = j.origin.trim() && j.destination.trim() && j.departs && (!j.arrives || j.arrives >= j.departs)
  return (
    <form
      className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onSave({ ...j, origin: j.origin.trim(), destination: j.destination.trim(), arrives: j.arrives || null, reference: j.reference?.trim() || null })
      }}
    >
      <label>
        <span className={label}>Type</span>
        <select
          value={j.kind}
          onChange={(e) => setJ({ ...j, kind: e.target.value as JourneyKind })}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base md:text-sm dark:bg-input/30"
        >
          {JOURNEY_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={label}>Number (optional)</span>
        <Input value={j.reference ?? ""} onChange={(e) => setJ({ ...j, reference: e.target.value })} placeholder="BA7" maxLength={40} />
      </label>
      <label>
        <span className={label}>From</span>
        <Input required value={j.origin} onChange={(e) => setJ({ ...j, origin: e.target.value })} placeholder="London Heathrow" maxLength={120} />
      </label>
      <label>
        <span className={label}>To</span>
        <Input required value={j.destination} onChange={(e) => setJ({ ...j, destination: e.target.value })} placeholder="Tokyo Haneda" maxLength={120} />
      </label>
      <label>
        <span className={label}>Departs (local time)</span>
        <Input type="datetime-local" required value={j.departs} onChange={(e) => setJ({ ...j, departs: e.target.value.slice(0, 16) })} />
      </label>
      <label>
        <span className={label}>Arrives (local time)</span>
        <Input type="datetime-local" value={j.arrives ?? ""} min={j.departs} onChange={(e) => setJ({ ...j, arrives: e.target.value.slice(0, 16) })} />
      </label>
      <FormButtons valid={!!valid} onCancel={onCancel} />
    </form>
  )
}

function FormButtons({ valid, onCancel }: { valid: boolean; onCancel: () => void }) {
  return (
    <div className="col-span-2 flex justify-end gap-2">
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" size="sm" disabled={!valid}>
        Save
      </Button>
    </div>
  )
}
