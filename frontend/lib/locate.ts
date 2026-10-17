// Server-only: coordinates for named activities in a city, for the map.
// Gemini knows most named places; each answer is checked to be near the city
// (so "Art Deco District, Miami" can't land in Tulsa). Anything missing or
// implausible is looked up on OpenStreetMap near the city centre.
import { geminiJSON } from "./gemini"
import { cityCentre, km, placeNear, type LatLng } from "./nominatim"
import type { EditableItem } from "./voice-edits"

const MAX_KM = 120 // day trips are fine; another city is not

export async function locatePlaces(city: string, country: string, names: string[]): Promise<Record<string, LatLng | null>> {
  const out: Record<string, LatLng | null> = {}
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 20)
  if (!unique.length) return out
  const centre = await cityCentre(city, country)
  const near = (p: LatLng | null | undefined) =>
    !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && (!centre || km(p, centre) <= MAX_KM)

  const key = process.env.GEMINI_API_KEY
  if (key) {
    const res = await geminiJSON<{ places?: { name?: string; lat?: number; lng?: number }[] }>({
      key,
      tag: "locate",
      temperature: 0,
      system: `You give real-world coordinates (WGS84, 4 decimals) for named places in a given city. Names may include words like "Lunch at"; locate the venue itself. Return one entry per input name, with the name exactly as given. If you don't know a place, give the coordinates of the neighbourhood it names, or omit it. Reply with JSON only: {"places": [{"name": string, "lat": number, "lng": number}]}`,
      prompt: JSON.stringify({ city, country, names: unique }),
      schema: {
        type: "OBJECT",
        properties: {
          places: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { name: { type: "STRING" }, lat: { type: "NUMBER" }, lng: { type: "NUMBER" } },
              required: ["name", "lat", "lng"],
            },
          },
        },
        required: ["places"],
      },
    })
    if (!("error" in res)) {
      for (const p of res.places ?? []) {
        const name = unique.find((n) => n.toLowerCase() === String(p.name ?? "").trim().toLowerCase())
        const at = { lat: Number(p.lat), lng: Number(p.lng) }
        if (name && near(at)) out[name] = { lat: Math.round(at.lat * 1e5) / 1e5, lng: Math.round(at.lng * 1e5) / 1e5 }
      }
    } else console.warn(`[locate] ${res.error.slice(0, 200)}`)
  }

  // OpenStreetMap for whatever's left, one at a time (its rate limit).
  for (const name of unique) {
    if (out[name]) continue
    out[name] = centre ? await placeNear(name, centre) : null
  }
  return out
}

/** Fill in missing coordinates on activities (and drop ones that are far from the city). */
export async function withCoordinates(city: string, country: string, items: EditableItem[]): Promise<EditableItem[]> {
  const centre = items.some((i) => i.lat !== undefined) ? await cityCentre(city, country) : null
  const fixed = items.map((i) =>
    i.lat !== undefined && i.lng !== undefined && centre && km({ lat: i.lat, lng: i.lng }, centre) > MAX_KM
      ? { ...i, lat: undefined, lng: undefined }
      : i,
  )
  const missing = fixed.filter((i) => i.lat === undefined || i.lng === undefined).map((i) => i.name)
  if (!missing.length) return fixed
  const found = await locatePlaces(city, country, missing)
  return fixed.map((i) => {
    const at = i.lat === undefined || i.lng === undefined ? found[i.name] : null
    return at ? { ...i, lat: at.lat, lng: at.lng } : i
  })
}
