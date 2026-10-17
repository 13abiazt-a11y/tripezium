// Shapes from the team API contract (roadmap section 5). Change only after telling the team.

export type Trip = {
  id: string
  destination: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  dayStart: string // HH:mm
  dayEnd: string // HH:mm
  travellers: number
  interests: string[]
}

export type Place = {
  id: string
  name: string
  nameEnglish: string
  category: string
  lat: number
  lng: number
  confidence: number
  sourceUrl?: string
  timestamp?: string
  tip?: string
}

export type ItineraryItem = {
  time: string // HH:mm
  placeId: string
  durationMins: number
  note?: string
}

export type ItineraryDay = {
  date: string // YYYY-MM-DD
  items: ItineraryItem[]
}
