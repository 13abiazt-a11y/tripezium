// Shapes from the team API contract (roadmap section 5). Change only after telling the team.

// One city the user is visiting. Dates are only set when "set dates for each city" is ticked.
export type CityStop = {
  id: string
  name: string
  startDate?: string // YYYY-MM-DD
  endDate?: string // YYYY-MM-DD
}

// One country section in the destination picker. Order here is NOT travel order.
export type CountryStop = {
  id: string
  country: string // ISO 3166-1 alpha-2, e.g. "FR"
  cities: CityStop[]
}

// One leg of the travel route, in travel order. Built from the stops with a
// recommended number of days, then reordered / adjusted on the itinerary page.
export type RouteStop = {
  cityId: string
  city: string
  country: string // ISO alpha-2
  days: number
}

export type Trip = {
  id: string
  destination: string // human summary of the stops, e.g. "France & Italy" (kept for the backend)
  stops: CountryStop[]
  datesPerCity: boolean
  route: RouteStop[]
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
