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
  explore?: boolean // whole country, no city picked: we suggest its most popular cities
}

export type Money = {
  amount: number
  currency: string // ISO 4217, e.g. "GBP"
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
  budget: { amount: number | null; currency: string } // whole trip, all travellers; amount null = not set
  synced?: string // what we last sent to the API (lib/api.ts syncTrip); differs => the server needs an update
}

export type Place = {
  id: string
  name: string
  nameEnglish: string
  category: string
  lat: number | null // null for an imported place we couldn't locate
  lng: number | null
  confidence: number | null
  sourceUrl?: string
  timestamp?: string
  tip?: string
}

export type ItineraryItem = {
  time: string // HH:mm
  placeId: string
  durationMins: number
  note?: string
  cost?: Money // estimated cost per person, in the home currency. Hidden in the UI until SHOW_COSTS is on (lib/flags.ts)
  localCost?: Money // the same cost in the local currency, as estimated (e.g. ¥2,500)
  status?: ItemStatus // from the API; absent for sample days
}

// "check_hours": open on normal weeks, but the hours on that date aren't certain (e.g. a public holiday).
export type ItemStatus = "ok" | "check_hours" | "closed"

export type ItineraryDay = {
  date: string // YYYY-MM-DD
  items: ItineraryItem[]
  city?: string | null // which city on a multi-city route
  holiday?: string | null // e.g. "New Year's Day"
  total?: Money // the day's cost per person, home currency
}

export type Itinerary = {
  days: ItineraryDay[]
  total: Money // whole trip, per person, home currency
}
