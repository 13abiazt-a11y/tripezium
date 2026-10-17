// Server-only: OpenStreetMap search (Nominatim). No key; about 1 request a second.
export type LatLng = { lat: number; lng: number }

const cache = new Map<string, LatLng | null>()

async function search(params: Record<string, string>): Promise<LatLng | null> {
  const q = new URLSearchParams({ format: "json", limit: "1", ...params })
  const key = q.toString()
  if (cache.has(key)) return cache.get(key)!
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
      headers: { "User-Agent": "Tripezium hackathon demo (IKU Womxn in STEM)", "Accept-Language": "en" },
    })
    if (!res.ok) {
      console.error("[nominatim]", res.status)
      return null
    }
    const [hit] = (await res.json().catch(() => [])) as { lat: string; lon: string }[]
    const value = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null
    cache.set(key, value)
    return value
  } catch (e) {
    console.error("[nominatim]", (e as Error).message)
    return null
  }
}

/** City centre. Prefers an actual city/town; falls back to free text (regions, islands). */
export async function cityCentre(city: string, country: string) {
  const cc: Record<string, string> = country ? { countrycodes: country.toLowerCase() } : {}
  return (await search({ city, ...cc })) ?? (await search({ q: city, ...cc }))
}

/** A named place, only searched within ~35 km of the city centre (never elsewhere in the country). */
export async function placeNear(name: string, centre: LatLng) {
  const d = 0.35
  const viewbox = [centre.lng - d, centre.lat + d, centre.lng + d, centre.lat - d].join(",")
  const cleaned = cleanPlaceName(name)
  return (
    (await search({ q: cleaned, viewbox, bounded: "1" })) ??
    (cleaned !== name ? await search({ q: name, viewbox, bounded: "1" }) : null)
  )
}

/** "Lunch at Momosan Wynwood" → "Momosan Wynwood"; "Stroll through the Art Deco District" → "Art Deco District". */
export function cleanPlaceName(name: string) {
  return name
    .replace(/^(breakfast|brunch|lunch|dinner|drinks|coffee|cocktails|snacks?|food|tea|dessert)\s+(at|in|on)\s+/i, "")
    .replace(/^(visit|explore|tour|walk|stroll|wander|relax|shop|shopping|sunset|morning|evening|afternoon)\s+(at|in|on|of|through|around|along|the)?\s*/i, "")
    .replace(/^the\s+/i, "")
    .trim()
}

/** Distance in km. */
export function km(a: LatLng, b: LatLng) {
  const r = (x: number) => (x * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}
