// Sample activities so every day shows something until C's itinerary endpoint
// (GET /trips/{id}/itinerary) is live. Costs are rough per-person estimates in
// the budget currency and stay hidden until SHOW_COSTS is on.
import type { ItineraryItem, Place } from "./types"

type Slot = [time: string, name: string, category: string, mins: number, cost: number]

const DAYS: Slot[][] = [
  [
    ["09:30", "Old town walking tour", "landmarks", 120, 15],
    ["12:00", "Lunch at a local market", "food", 75, 18],
    ["14:00", "Top museum or gallery", "museums", 120, 20],
    ["19:30", "Dinner at a local favourite", "food", 90, 35],
  ],
  [
    ["09:00", "Morning viewpoint or park", "nature", 90, 0],
    ["11:00", "Historic quarter & landmarks", "landmarks", 150, 12],
    ["14:30", "Neighbourhood café break", "food", 45, 8],
    ["16:00", "Shopping streets", "shopping", 120, 0],
    ["20:00", "Evening out", "nightlife", 120, 30],
  ],
  [
    ["10:00", "Day trip or hidden gem", "hidden gems", 240, 40],
    ["15:00", "Food tour", "food", 150, 45],
    ["19:00", "Sunset photo spot", "photo spots", 60, 0],
  ],
]

export function sampleDay(city: string, dayInCity: number, currency: string) {
  const slots = DAYS[(dayInCity - 1) % DAYS.length]
  const places: Place[] = []
  const items: ItineraryItem[] = slots.map(([time, name, category, durationMins, amount], i) => {
    const id = `sample-${city}-${dayInCity}-${i}`
    places.push({ id, name, nameEnglish: name, category, lat: 0, lng: 0, confidence: 0 })
    return { time, placeId: id, durationMins, cost: { amount, currency } }
  })
  return { items, places }
}
