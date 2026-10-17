"use client"

// Days planned with real places by /api/plan-day, for days that only had
// placeholder activities. Saved per trip in this browser, keyed by date + city,
// so each day is only planned once. Replace with C's itinerary endpoint later.
import type { EditableItem } from "./voice-edits"

export type DayPlans = Record<string, EditableItem[]>

export const planKey = (date: string, city: string) => `${date}|${city.toLowerCase()}`
const key = (tripKey: string) => `day-plans:${tripKey}`

export function loadPlans(tripKey: string): DayPlans {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(tripKey)) ?? "{}")
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function savePlans(tripKey: string, plans: DayPlans) {
  try {
    localStorage.setItem(key(tripKey), JSON.stringify(plans))
  } catch {
    // storage blocked: plans last until the page is closed
  }
}
