"use client"

// The plan's cost against the budget, on the itinerary page. The total follows
// the plan (route updates, voice changes), and the budget can be changed here.
import { useState } from "react"
import { Check, Pencil, Wallet, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatMoney } from "@/lib/money"
import type { Money } from "@/lib/types"

export function BudgetCard({
  perPerson,
  travellers,
  budget,
  editable,
  changedDays,
  unpriced,
  onChangeBudget,
}: {
  perPerson: Money
  travellers: number
  budget: number | null // whole trip, all travellers, in perPerson.currency
  editable: boolean
  changedDays: number // days changed by voice (their costs are recalculated)
  unpriced: number // changed activities without a price
  onChangeBudget: (amount: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState("")
  const group = { ...perPerson, amount: perPerson.amount * travellers }
  const money = (amount: number) => formatMoney({ amount, currency: perPerson.currency })

  const startEdit = () => {
    setDraft(budget ? String(budget) : "")
    setError("")
    setEditing(true)
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = draft.trim() === "" ? null : Number(draft.replace(/[,\s]/g, ""))
    if (value !== null && !(value > 0)) return setError("Enter an amount above 0, or leave it empty for no budget.")
    onChangeBudget(value === null ? null : Math.round(value))
    setEditing(false)
  }

  const used = budget ? Math.min(1, group.amount / budget) : 0
  const over = budget !== null && group.amount > budget

  return (
    <section className="mb-4 rounded-xl bg-card p-3 text-sm ring-1 ring-foreground/10" aria-label="Cost and budget">
      <p className="inline-flex items-center gap-1.5 font-medium">
        <Wallet className="size-4 text-primary" /> About {formatMoney(perPerson)} per person
        {travellers > 1 ? ` · ${formatMoney(group)} for ${travellers}` : ""}
      </p>

      {editing ? (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
          <label htmlFor="budget-input" className="text-xs text-muted-foreground">
            Budget for the whole trip, {travellers > 1 ? `all ${travellers} travellers` : "you"} ({perPerson.currency})
          </label>
          <div className="flex gap-2">
            <Input
              id="budget-input"
              inputMode="decimal"
              autoFocus
              placeholder="e.g. 1500"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-10"
            />
            <Button type="submit" className="h-10 px-3">
              <Check /> Save
            </Button>
            <Button type="button" variant="ghost" className="h-10 px-2" aria-label="Cancel" onClick={() => setEditing(false)}>
              <X />
            </Button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </form>
      ) : budget !== null ? (
        <>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={Math.round(group.amount)}
            aria-label="Budget used"
          >
            <div className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`} style={{ width: `${used * 100}%` }} />
          </div>
          <div className="mt-2 flex items-start justify-between gap-3">
            <p className={over ? "font-medium text-destructive" : "text-muted-foreground"}>
              {over
                ? `About ${money(group.amount - budget)} over your ${money(budget)} budget.`
                : `Within your ${money(budget)} budget, with about ${money(budget - group.amount)} to spare.`}
            </p>
            {editable ? (
              <button onClick={startEdit} className="inline-flex shrink-0 items-center gap-1 font-medium text-primary">
                <Pencil className="size-3.5" /> Edit budget
              </button>
            ) : null}
          </div>
        </>
      ) : editable ? (
        <button onClick={startEdit} className="mt-2 inline-flex items-center gap-1 font-medium text-primary">
          <Pencil className="size-3.5" /> Set a budget
        </button>
      ) : null}

      {changedDays ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Includes your voice changes on {changedDays} {changedDays === 1 ? "day" : "days"}
          {unpriced ? `. ${unpriced} new ${unpriced === 1 ? "stop has" : "stops have"} no price yet.` : "."}
        </p>
      ) : null}
    </section>
  )
}
