// Small pieces shared by the itinerary and final-plan pages.
import { Footprints, TrainFront, TramFront } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/money"
import { describeLeg, estimateLeg, gapMins } from "@/lib/travel"
import type { ItineraryItem } from "@/lib/types"
import type { EditableItem } from "@/lib/voice-edits"

export function formatDay(date: string, long = false) {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: long ? "long" : "short",
    day: "numeric",
    month: long ? "long" : "short",
  })
}

export function formatDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ")
}

export function Cost({ item }: { item: EditableItem }) {
  if (!item.cost) return null
  if (item.cost.amount === 0) return <span className="font-medium text-foreground">Free</span>
  const local = item.localCost && item.localCost.currency !== item.cost.currency ? item.localCost : null
  return (
    <span className="font-medium text-foreground">
      ~{formatMoney(item.cost)}
      {local ? <span className="font-normal text-muted-foreground"> · {formatMoney(local)}</span> : null}
    </span>
  )
}

export function StatusBadge({ status }: { status?: ItineraryItem["status"] }) {
  if (status === "check_hours") return <Badge variant="outline">Check hours</Badge>
  if (status === "closed") return <Badge variant="destructive">Closed</Badge>
  return null
}

/** How you get here from the previous stop; red if the plan doesn't leave enough time (e.g. after a voice edit). */
export function TravelHint({ prev, item, className = "" }: { prev: EditableItem; item: EditableItem; className?: string }) {
  const leg = estimateLeg(prev, item)
  if (!leg) return null
  const gap = gapMins(prev, item)
  const tight = gap < leg.mins
  const Icon = leg.mode === "walk" ? Footprints : leg.mode === "train" ? TrainFront : TramFront
  return (
    <p className={`flex items-center gap-1.5 text-xs ${tight ? "font-medium text-destructive" : "text-muted-foreground"} ${className}`}>
      <Icon className="size-3.5 shrink-0" />
      {describeLeg(leg)}
      {tight ? ` · only ${Math.max(gap, 0)} min to get here` : ""}
    </p>
  )
}
