// Country + city data for the destination picker.
// Every country is pickable; popular ones come with suggested cities.
// Users can always type a city that isn't listed.

// ISO 3166-1 alpha-2 codes. Names come from the browser (Intl.DisplayNames).
const CODES =
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(
    " ",
  )

// Suggested cities. A leading "*" marks a big city that gets a little more
// time when we recommend how many days to spend in each place.
const CITIES: Record<string, string[]> = {
  AT: ["*Vienna", "Salzburg", "Innsbruck", "Hallstatt", "Graz"],
  AU: ["*Sydney", "*Melbourne", "Brisbane", "Cairns", "Perth", "Gold Coast", "Adelaide"],
  BE: ["Brussels", "Bruges", "Ghent", "Antwerp"],
  BR: ["*Rio de Janeiro", "São Paulo", "Salvador", "Florianópolis", "Foz do Iguaçu"],
  CA: ["*Toronto", "*Vancouver", "Montreal", "Quebec City", "Banff", "Ottawa"],
  CH: ["Zurich", "Geneva", "Lucerne", "Interlaken", "Zermatt", "Bern", "Lausanne"],
  CN: ["*Beijing", "*Shanghai", "Xi'an", "Chengdu", "Guilin", "Hangzhou"],
  CZ: ["*Prague", "Český Krumlov", "Brno", "Karlovy Vary"],
  DE: ["*Berlin", "*Munich", "Hamburg", "Cologne", "Frankfurt", "Heidelberg", "Dresden"],
  DK: ["*Copenhagen", "Aarhus", "Odense"],
  EG: ["*Cairo", "Luxor", "Aswan", "Alexandria", "Hurghada"],
  ES: ["*Barcelona", "*Madrid", "Seville", "Granada", "Valencia", "Málaga", "San Sebastián", "Palma"],
  FI: ["Helsinki", "Rovaniemi", "Turku"],
  FR: ["*Paris", "Nice", "Lyon", "Marseille", "Bordeaux", "Strasbourg", "Avignon", "Annecy"],
  GB: ["*London", "Edinburgh", "Manchester", "Bath", "Oxford", "York", "Liverpool", "Cambridge"],
  GR: ["*Athens", "Santorini", "Mykonos", "Crete", "Thessaloniki", "Corfu", "Rhodes"],
  HK: ["Hong Kong"],
  HR: ["Dubrovnik", "Split", "Zagreb", "Hvar", "Zadar"],
  HU: ["*Budapest", "Eger", "Lake Balaton"],
  ID: ["*Bali", "Jakarta", "Yogyakarta", "Lombok", "Komodo"],
  IE: ["*Dublin", "Galway", "Cork", "Killarney"],
  IN: ["*Delhi", "*Mumbai", "Jaipur", "Agra", "Goa", "Udaipur", "Varanasi", "Kerala"],
  IS: ["Reykjavík", "Vík", "Akureyri"],
  IT: ["*Rome", "Florence", "Venice", "Milan", "Naples", "Amalfi Coast", "Bologna", "Cinque Terre"],
  JP: ["*Tokyo", "Kyoto", "Osaka", "Hiroshima", "Nara", "Hakone", "Sapporo", "Kanazawa"],
  KR: ["*Seoul", "Busan", "Jeju", "Gyeongju", "Incheon"],
  MA: ["*Marrakech", "Fes", "Chefchaouen", "Casablanca", "Essaouira"],
  MX: ["*Mexico City", "Cancún", "Tulum", "Oaxaca", "Guadalajara", "Playa del Carmen"],
  MY: ["*Kuala Lumpur", "Penang", "Langkawi", "Malacca"],
  NL: ["*Amsterdam", "Rotterdam", "Utrecht", "The Hague"],
  NO: ["Oslo", "Bergen", "Tromsø", "Flåm", "Stavanger"],
  NZ: ["Auckland", "Queenstown", "Wellington", "Rotorua", "Christchurch"],
  PE: ["Lima", "Cusco", "Machu Picchu", "Arequipa"],
  PH: ["Manila", "Cebu", "Palawan", "Boracay", "Siargao"],
  PL: ["*Kraków", "Warsaw", "Gdańsk", "Wrocław"],
  PT: ["*Lisbon", "Porto", "Sintra", "Lagos", "Madeira", "Faro"],
  SE: ["*Stockholm", "Gothenburg", "Malmö", "Kiruna"],
  SG: ["Singapore"],
  TH: ["*Bangkok", "Chiang Mai", "Phuket", "Krabi", "Koh Samui", "Ayutthaya"],
  TR: ["*Istanbul", "Cappadocia", "Antalya", "Izmir", "Bodrum", "Pamukkale"],
  TW: ["*Taipei", "Tainan", "Kaohsiung", "Taichung", "Hualien"],
  AE: ["*Dubai", "Abu Dhabi"],
  US: ["*New York", "Los Angeles", "San Francisco", "Las Vegas", "Chicago", "Miami", "New Orleans", "Washington, D.C."],
  VN: ["Hanoi", "Ho Chi Minh City", "Hoi An", "Ha Long Bay", "Da Nang", "Hue"],
  ZA: ["*Cape Town", "Johannesburg", "Kruger", "Durban"],
}

// Shown before the user types, to save them a search.
export const POPULAR = ["FR", "IT", "ES", "JP", "GB", "PT", "GR", "US"]

export type Country = { code: string; name: string; flag: string }

export function flagOf(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)))
}

let names: Intl.DisplayNames | null = null
export function countryName(code: string) {
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" })
    return names.of(code) ?? code
  } catch {
    return code
  }
}

export const COUNTRIES: Country[] = CODES.map((code) => ({ code, name: countryName(code), flag: flagOf(code) })).sort(
  (a, b) => a.name.localeCompare(b.name),
)

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()

export function searchCountries(query: string, exclude: string[] = [], limit = 6): Country[] {
  const q = norm(query)
  if (!q) return []
  const pool = COUNTRIES.filter((c) => !exclude.includes(c.code))
  const starts = pool.filter((c) => norm(c.name).startsWith(q))
  const contains = pool.filter((c) => !norm(c.name).startsWith(q) && norm(c.name).includes(q))
  return [...starts, ...contains].slice(0, limit)
}

export function suggestedCities(code: string): string[] {
  return (CITIES[code] ?? []).map((c) => c.replace(/^\*/, ""))
}

export function isBigCity(code: string, city: string) {
  return (CITIES[code] ?? []).includes("*" + city)
}
