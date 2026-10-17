// Interests shown on step 2, tailored to where the user is going.
// - GENERAL: fit almost anywhere (a few are hidden where they don't make sense).
// - BY_COUNTRY / BY_CITY: things a place is known for, shown first.
// Interest ids go to the backend in Trip.interests. Anything the user types
// themselves is stored as plain text in the same array.
import { countryName } from "./destinations"
import type { CountryStop } from "./types"

export type Interest = { id: string; label: string; emoji: string }

const i = (id: string, label: string, emoji: string): Interest => ({ id, label, emoji })

// Countries with no coastline: no beach suggestions.
const LANDLOCKED = new Set(
  "AD AF AM AT AZ BF BI BO BT BW BY CF CH CZ ET HU KG KZ LA LI LS LU MD MK ML MN MW NE NP PY RS RW SK SM SS SZ TD TJ TM UG UZ VA XK ZM ZW".split(" "),
)
// Where temples and shrines are a big part of a visit.
const TEMPLE_COUNTRIES = new Set("JP CN TH KR VN IN ID MY TW KH LA MM NP LK SG HK BT MN".split(" "))

const GENERAL: (Interest & { show?: (countries: string[]) => boolean })[] = [
  i("food", "Food & drink", "🍽️"),
  i("landmarks", "Landmarks", "📍"),
  i("history", "History", "📜"),
  i("museums", "Museums", "🏛️"),
  i("art", "Art", "🎨"),
  i("architecture", "Architecture", "🏙️"),
  i("nature", "Nature & parks", "🌳"),
  { ...i("beaches", "Beaches", "🏖️"), show: (cs) => cs.some((c) => !LANDLOCKED.has(c)) },
  { ...i("temples", "Temples & shrines", "⛩️"), show: (cs) => cs.some((c) => TEMPLE_COUNTRIES.has(c)) },
  i("markets", "Markets", "🧺"),
  i("shopping", "Shopping", "🛍️"),
  i("nightlife", "Nightlife", "🌙"),
  i("live-music", "Live music", "🎶"),
  i("hiking", "Hiking", "🥾"),
  i("hidden-gems", "Hidden gems", "💎"),
  i("photo-spots", "Photo spots", "📸"),
  i("family", "Family-friendly", "👨‍👩‍👧"),
  i("relaxed", "Slow & relaxed", "☕"),
  i("budget-friendly", "Free & cheap things", "💸"),
]

const BY_COUNTRY: Record<string, Interest[]> = {
  JP: [i("onsen", "Onsen & hot springs", "♨️"), i("anime", "Anime & manga", "🎌"), i("sushi-ramen", "Sushi & ramen", "🍣"), i("japanese-gardens", "Japanese gardens", "🌸"), i("izakaya", "Izakaya nights", "🏮")],
  IT: [i("roman-ruins", "Roman ruins", "🏛️"), i("churches", "Churches & cathedrals", "⛪"), i("wine", "Wine tasting", "🍷"), i("pasta-pizza", "Pasta & pizza", "🍝"), i("renaissance-art", "Renaissance art", "🖼️"), i("gelato", "Gelato crawl", "🍨")],
  FR: [i("wine", "Wine & vineyards", "🍷"), i("cafes-patisseries", "Cafés & patisseries", "🥐"), i("chateaux", "Châteaux", "🏰"), i("fashion", "Fashion & boutiques", "👗"), i("churches", "Churches & cathedrals", "⛪")],
  ES: [i("tapas", "Tapas", "🥘"), i("flamenco", "Flamenco", "💃"), i("gaudi", "Gaudí & modernisme", "🦎"), i("football", "Football", "⚽"), i("churches", "Churches & cathedrals", "⛪")],
  PT: [i("port-wine", "Port & wine tasting", "🍷"), i("fado", "Fado music", "🎶"), i("surfing", "Surfing", "🏄"), i("pastel-de-nata", "Pastéis de nata", "🥮"), i("azulejos", "Azulejo tiles", "🔷")],
  GB: [i("pubs", "Pubs", "🍺"), i("castles", "Castles", "🏰"), i("theatre", "Theatre & musicals", "🎭"), i("football", "Football", "⚽"), i("royal-history", "Royal history", "👑")],
  IE: [i("pubs", "Pubs & trad music", "🍺"), i("castles", "Castles", "🏰"), i("coastal-drives", "Coastal drives", "🚗")],
  GR: [i("ancient-ruins", "Ancient ruins", "🏛️"), i("island-hopping", "Island hopping", "⛵"), i("greek-food", "Greek food", "🫒")],
  DE: [i("beer-halls", "Beer halls", "🍺"), i("castles", "Castles", "🏰"), i("christmas-markets", "Christmas markets", "🎄"), i("modern-history", "WWII & Cold War history", "🧱")],
  NL: [i("cycling", "Cycling", "🚲"), i("canals", "Canal cruises", "🛶"), i("tulips", "Tulips & gardens", "🌷"), i("dutch-masters", "Dutch masters", "🖼️")],
  BE: [i("chocolate-waffles", "Chocolate & waffles", "🧇"), i("belgian-beer", "Belgian beer", "🍺")],
  CH: [i("alps", "Alps & lakes", "🏔️"), i("skiing", "Skiing", "⛷️"), i("scenic-trains", "Scenic trains", "🚆"), i("chocolate-cheese", "Chocolate & cheese", "🧀")],
  AT: [i("classical-music", "Classical music", "🎻"), i("coffee-houses", "Coffee houses", "☕"), i("skiing", "Skiing", "⛷️"), i("palaces", "Palaces", "🏰")],
  CZ: [i("czech-beer", "Czech beer", "🍺"), i("castles", "Castles", "🏰")],
  HU: [i("thermal-baths", "Thermal baths", "♨️"), i("ruin-bars", "Ruin bars", "🍸")],
  PL: [i("castles", "Castles", "🏰"), i("modern-history", "WWII history", "🧱"), i("pierogi", "Pierogi & Polish food", "🥟")],
  HR: [i("island-hopping", "Island hopping", "⛵"), i("film-locations", "Game of Thrones spots", "🎬"), i("lakes-waterfalls", "Lakes & waterfalls", "💧")],
  DK: [i("design", "Scandi design", "🪑"), i("cycling", "Cycling", "🚲"), i("hygge", "Hygge cafés", "☕")],
  SE: [i("design", "Scandi design", "🪑"), i("fika", "Fika", "☕"), i("northern-lights", "Northern lights", "🌌")],
  NO: [i("fjords", "Fjords", "⛴️"), i("northern-lights", "Northern lights", "🌌")],
  FI: [i("sauna", "Saunas", "🧖"), i("northern-lights", "Northern lights", "🌌"), i("lapland", "Lapland & Santa", "🎅")],
  IS: [i("northern-lights", "Northern lights", "🌌"), i("hot-springs", "Hot springs", "♨️"), i("glaciers", "Glaciers & waterfalls", "🧊")],
  TR: [i("bazaars", "Bazaars", "🧿"), i("hammam", "Hammams", "🛁"), i("hot-air-balloons", "Hot-air balloons", "🎈"), i("mosques", "Mosques", "🕌")],
  EG: [i("ancient-egypt", "Pyramids & ancient Egypt", "🏺"), i("nile-cruise", "Nile cruise", "⛴️"), i("desert", "Desert trips", "🐪"), i("diving", "Diving & snorkelling", "🤿")],
  MA: [i("souks", "Souks", "🧿"), i("desert", "Desert camps", "🐪"), i("hammam", "Hammams", "🛁"), i("medinas", "Medinas & riads", "🕌")],
  AE: [i("desert", "Desert safari", "🐪"), i("skyscrapers", "Skyscrapers & views", "🏙️"), i("luxury", "Luxury & malls", "💎")],
  TH: [i("street-food", "Street food", "🍢"), i("island-hopping", "Island hopping", "🏝️"), i("thai-massage", "Thai massage", "💆"), i("night-markets", "Night markets", "🌃")],
  VN: [i("street-food", "Street food", "🍜"), i("motorbike-tours", "Motorbike tours", "🛵"), i("bays-caves", "Bays & caves", "🛶")],
  ID: [i("surfing", "Surfing", "🏄"), i("diving", "Diving & snorkelling", "🤿"), i("rice-terraces", "Rice terraces", "🌾"), i("volcanoes", "Volcano hikes", "🌋")],
  MY: [i("street-food", "Street food", "🍜"), i("rainforest", "Rainforest", "🌴"), i("island-hopping", "Islands", "🏝️")],
  SG: [i("hawker-food", "Hawker food", "🍜"), i("gardens", "Gardens", "🌿"), i("rooftop-bars", "Rooftop bars", "🍸")],
  HK: [i("dim-sum", "Dim sum", "🥟"), i("skyline", "Skyline views", "🏙️")],
  TW: [i("night-markets", "Night markets", "🌃"), i("hot-springs", "Hot springs", "♨️"), i("bubble-tea", "Bubble tea", "🧋")],
  CN: [i("great-wall", "Great Wall & ancient sites", "🧱"), i("dim-sum", "Dumplings & dim sum", "🥟"), i("tea", "Tea culture", "🍵")],
  KR: [i("k-culture", "K-pop & K-culture", "🎤"), i("korean-bbq", "Korean BBQ", "🍖"), i("palaces", "Palaces", "🏯"), i("skincare", "Skincare shopping", "🧴")],
  IN: [i("palaces-forts", "Palaces & forts", "🏰"), i("yoga", "Yoga & wellness", "🧘"), i("street-food", "Spices & street food", "🌶️")],
  PH: [i("island-hopping", "Island hopping", "🏝️"), i("diving", "Diving & snorkelling", "🤿")],
  US: [i("national-parks", "National parks", "🏞️"), i("theme-parks", "Theme parks", "🎢"), i("sports-games", "Sports games", "🏟️"), i("road-trips", "Road trips", "🚗")],
  CA: [i("national-parks", "National parks", "🏞️"), i("skiing", "Skiing", "⛷️"), i("wildlife", "Wildlife", "🐻")],
  MX: [i("ancient-ruins", "Mayan & Aztec ruins", "🗿"), i("tacos", "Tacos & street food", "🌮"), i("cenotes", "Cenotes", "🏊"), i("day-of-the-dead", "Día de Muertos culture", "💀")],
  BR: [i("samba", "Samba & carnival", "💃"), i("football", "Football", "⚽"), i("rainforest", "Rainforest", "🌴")],
  PE: [i("ancient-ruins", "Inca ruins", "🗿"), i("ceviche", "Ceviche & Peruvian food", "🐟")],
  AU: [i("wildlife", "Wildlife", "🐨"), i("surfing", "Surfing", "🏄"), i("diving", "Reef diving", "🤿"), i("road-trips", "Road trips", "🚗")],
  NZ: [i("adventure", "Adventure sports", "🪂"), i("film-locations", "Film locations", "🎬"), i("wine", "Wineries", "🍷")],
  ZA: [i("safari", "Safari", "🦁"), i("wine", "Wine tasting", "🍷")],
}

const BY_CITY: Record<string, Interest[]> = {
  Venice: [i("gondola", "Gondola ride", "🛶")],
  Kyoto: [i("tea-ceremony", "Tea ceremony", "🍵"), i("geisha-district", "Geisha districts", "👘")],
  Tokyo: [i("arcades", "Arcades & gaming", "🕹️")],
  Paris: [i("cabaret", "Cabaret & shows", "🎭")],
  London: [i("afternoon-tea", "Afternoon tea", "🫖")],
  "New York": [i("theatre", "Broadway shows", "🎭")],
  "Las Vegas": [i("shows-casinos", "Shows & casinos", "🎰")],
  Bali: [i("yoga", "Yoga retreats", "🧘")],
  Marrakech: [i("cooking-class", "Cooking class", "🍲")],
  Amsterdam: [i("canals", "Canal cruises", "🛶")],
}

const ALL_IDS = new Set([
  ...GENERAL.map((x) => x.id),
  ...Object.values(BY_COUNTRY).flat().map((x) => x.id),
  ...Object.values(BY_CITY).flat().map((x) => x.id),
])

/** True for one of our preset ids, false for text the user typed. */
export const isPreset = (value: string) => ALL_IDS.has(value)

/** Interests for this trip: "known for" picks for its places first, then general ones. */
export function interestsFor(stops: CountryStop[]) {
  const countries = stops.map((s) => s.country).filter(Boolean)
  const cities = stops.flatMap((s) => s.cities.map((c) => c.name))
  const seen = new Set<string>()
  const keep = (x: Interest) => !seen.has(x.id) && !!seen.add(x.id)

  const special = [...cities.flatMap((c) => BY_CITY[c] ?? []), ...countries.flatMap((c) => BY_COUNTRY[c] ?? [])].filter(keep)
  const general = GENERAL.filter((x) => !countries.length || !x.show || x.show(countries)).filter(keep)
  const places = countries.length === 1 && cities.length === 1 ? cities[0] : summariseCountries(countries)
  return { special, general, places }
}

function summariseCountries(codes: string[]) {
  const names = codes.map(countryName)
  return names.length <= 2 ? names.join(" & ") : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`
}
