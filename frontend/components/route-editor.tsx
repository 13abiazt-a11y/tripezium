"use client"

// Travel route on the itinerary page: drag cities into travel order and
// change how many days to spend in each. Works with touch, mouse and keyboard
// (focus a handle, then use the arrow keys).
import { useRef, useState } from "react"
import { GripVertical, Minus, Plus, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { flagOf } from "@/lib/destinations"
import type { RouteStop } from "@/lib/types"

type Drag = { from: number; to: number; dy: number; startY: number; mids: number[]; height: number }

export function RouteEditor({
  route,
  tripDays,
  onChange,
  onReset,
  onFitEndDate,
}: {
  route: RouteStop[]
  tripDays: number
  onChange: (route: RouteStop[]) => void
  onReset: () => void
  onFitEndDate: () => void
}) {
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const [drag, setDrag] = useState<Drag | null>(null)

  const total = route.reduce((n, r) => n + r.days, 0)
  const diff = total - tripDays

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= route.length) return
    const next = [...route]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }
  const setDays = (i: number, days: number) =>
    onChange(route.map((r, j) => (j === i ? { ...r, days: Math.max(1, Math.min(60, days)) } : r)))

  function onPointerDown(e: React.PointerEvent, i: number) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rects = rows.current.map((el) => el?.getBoundingClientRect())
    setDrag({
      from: i,
      to: i,
      dy: 0,
      startY: e.clientY,
      mids: rects.map((r) => (r ? r.top + r.height / 2 : 0)),
      height: (rects[i]?.height ?? 0) + 8, // + gap
    })
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return
    const dy = e.clientY - drag.startY
    const y = drag.mids[drag.from] + dy
    let to = drag.from
    while (to < drag.mids.length - 1 && y > drag.mids[to + 1]) to++
    while (to > 0 && y < drag.mids[to - 1]) to--
    setDrag({ ...drag, dy, to })
  }
  function onPointerUp() {
    if (!drag) return
    move(drag.from, drag.to)
    setDrag(null)
  }

  // How far each non-dragged row should slide to make room.
  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.height
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return drag.height
    return 0
  }

  return (
    <section className="mb-5 rounded-xl bg-card p-3 ring-1 ring-foreground/10" aria-label="Your route">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-medium">Your route</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw /> Reset
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Drag to set the order you’ll travel in. Tap − / + to change the days.</p>

      <ol className="flex flex-col gap-2">
        {route.map((r, i) => {
          const dragging = drag !== null && drag.from === i
          return (
            <li
              key={r.cityId}
              ref={(el) => {
                rows.current[i] = el
              }}
              style={{
                transform: `translateY(${dragging ? drag!.dy : shift(i)}px)`,
                transition: dragging ? "none" : "transform 150ms ease",
              }}
              className={`relative flex items-center gap-2 rounded-lg bg-card py-1.5 pr-1.5 pl-1 ring-1 ring-foreground/10 ${
                dragging ? "z-10 shadow-lg ring-primary" : ""
              }`}
            >
              <button
                type="button"
                aria-label={`Move ${r.city}. Use arrow keys to reorder.`}
                className="flex h-9 w-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault()
                    move(i, e.key === "ArrowUp" ? i - 1 : i + 1)
                  }
                }}
              >
                <GripVertical className="size-4" />
              </button>
              <span className="w-5 text-center text-xs font-medium text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="text-lg leading-none" aria-hidden>
                {flagOf(r.country)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {r.city}
                {r.explore ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">· top cities</span> : null}
              </span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="icon" aria-label={`One day less in ${r.city}`} disabled={r.days <= 1} onClick={() => setDays(i, r.days - 1)}>
                  <Minus />
                </Button>
                <span className="w-12 text-center text-sm tabular-nums" aria-live="polite">
                  {r.days} {r.days === 1 ? "day" : "days"}
                </span>
                <Button type="button" variant="outline" size="icon" aria-label={`One more day in ${r.city}`} onClick={() => setDays(i, r.days + 1)}>
                  <Plus />
                </Button>
              </div>
            </li>
          )
        })}
      </ol>

      <div
        className={`mt-3 rounded-lg px-3 py-2 text-xs ${
          diff === 0 ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        }`}
        aria-live="polite"
      >
        {diff === 0 ? (
          <>All {tripDays} days planned.</>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {total} of {tripDays} days planned · {Math.abs(diff)} {Math.abs(diff) === 1 ? "day" : "days"}{" "}
              {diff > 0 ? "too many" : "spare"}
            </span>
            <button type="button" className="font-medium underline underline-offset-2" onClick={onFitEndDate}>
              {diff > 0 ? "Extend trip" : "Shorten trip"} to {total} days
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
