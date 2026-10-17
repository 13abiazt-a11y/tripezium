// Mock data matching the API contract, used until the backend endpoints are live.
import type { ItineraryDay, Place, Trip } from "./types"

export const mockTrip: Trip = {
  id: "t1",
  destination: "Tokyo",
  startDate: "2026-12-01",
  endDate: "2026-12-03",
  dayStart: "09:00",
  dayEnd: "21:00",
  travellers: 2,
  interests: ["food", "temples", "nightlife"],
}

export const mockPlaces: Place[] = [
  { id: "p1", name: "Senso-ji", nameEnglish: "Senso-ji", category: "temple", lat: 35.7148, lng: 139.7967, confidence: 0.9, tip: "Go early to beat the crowds" },
  { id: "p2", name: "Nakamise-dori", nameEnglish: "Nakamise Street", category: "market", lat: 35.7119, lng: 139.7965, confidence: 0.85, tip: "Try the ningyo-yaki" },
  { id: "p3", name: "Tokyo Skytree", nameEnglish: "Tokyo Skytree", category: "landmark", lat: 35.7101, lng: 139.8107, confidence: 0.95 },
  { id: "p4", name: "Omoide Yokocho", nameEnglish: "Memory Lane", category: "food", lat: 35.6938, lng: 139.6995, confidence: 0.8, tip: "Cash only at most stalls" },
  { id: "p5", name: "Meiji Jingu", nameEnglish: "Meiji Shrine", category: "temple", lat: 35.6764, lng: 139.6993, confidence: 0.92 },
  { id: "p6", name: "Takeshita-dori", nameEnglish: "Takeshita Street", category: "shopping", lat: 35.6716, lng: 139.7031, confidence: 0.75 },
  { id: "p7", name: "Shibuya Crossing", nameEnglish: "Shibuya Crossing", category: "landmark", lat: 35.6595, lng: 139.7005, confidence: 0.97, tip: "Watch from the Starbucks above" },
  { id: "p8", name: "Golden Gai", nameEnglish: "Golden Gai", category: "nightlife", lat: 35.6941, lng: 139.7045, confidence: 0.88 },
  { id: "p9", name: "Tsukiji Outer Market", nameEnglish: "Tsukiji Outer Market", category: "food", lat: 35.6654, lng: 139.7707, confidence: 0.9, tip: "Best before 11:00" },
  { id: "p10", name: "teamLab Planets", nameEnglish: "teamLab Planets", category: "art", lat: 35.6491, lng: 139.7898, confidence: 0.86, tip: "Book tickets ahead" },
]

export const mockItinerary: ItineraryDay[] = [
  {
    date: "2026-12-01",
    items: [
      { time: "09:00", placeId: "p1", durationMins: 90, note: "Start here" },
      { time: "10:30", placeId: "p2", durationMins: 60 },
      { time: "13:00", placeId: "p3", durationMins: 120 },
      { time: "19:00", placeId: "p4", durationMins: 90, note: "Dinner" },
    ],
  },
  {
    date: "2026-12-02",
    items: [
      { time: "09:00", placeId: "p5", durationMins: 90 },
      { time: "11:00", placeId: "p6", durationMins: 90 },
      { time: "15:00", placeId: "p7", durationMins: 60 },
      { time: "20:00", placeId: "p8", durationMins: 120, note: "Drinks" },
    ],
  },
  {
    date: "2026-12-03",
    items: [
      { time: "09:00", placeId: "p9", durationMins: 120, note: "Breakfast" },
      { time: "13:00", placeId: "p10", durationMins: 150 },
    ],
  },
]
