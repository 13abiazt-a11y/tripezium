// Small pieces shared by the itinerary and final-plan pages.
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/money"
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
