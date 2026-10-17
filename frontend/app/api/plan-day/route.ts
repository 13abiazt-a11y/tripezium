// Plans one day with real, named places (and their coordinates, for the map).
// Used for days that only have placeholder activities until C's itinerary
// endpoint is live. Needs GEMINI_API_KEY in .env.local.
// POST JSON { city, country, date, dayInCity, daysInCity, interests, travellers,
//             dayStart, dayEnd, avoid } → { items }
import { cleanItems, geminiJSON, ITEM_SCHEMA, ITEM_SHAPE } from "@/lib/gemini"
import { withCoordinates } from "@/lib/locate"

export const maxDuration = 30 // seconds (Vercel)

const SYSTEM = `You plan one day of a trip with real places. Return 3 to 5 activities for the given city and date.

- Every activity is a real, specific, currently operating place or experience in or right next to the city (a named landmark, museum, market, restaurant, park, neighbourhood walk…), never a generic placeholder.
- Fit the traveller's interests. Include lunch and dinner at named places (good local food, mid-range).
- Times are 24-hour "HH:mm", sorted, not overlapping, within the day start and end, leaving travel time; group nearby places so the day flows.
- durationMins is realistic. category is one or two lowercase words (food, museum, landmark, temple, nature, shopping, nightlife, art, tour, market…).
- Add a short, practical tip where it helps (booking, best time, what to order).
- "lat" and "lng" are the place's real coordinates (WGS84, 4 decimals).
- Don't repeat any place listed in "avoid" (already planned on other days).
- If it's day 2 or later in the city, choose a different area of the city from day 1 where sensible.

Reply with JSON only: {"items": [${ITEM_SHAPE}]}`

const SCHEMA = {
  type: "OBJECT",
  properties: { items: { type: "ARRAY", items: ITEM_SCHEMA } },
  required: ["items"],
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    console.error("[plan-day] GEMINI_API_KEY is not set (add it to .env.local and restart)")
    return Response.json({ error: "Planning not configured" }, { status: 500 })
  }
  const body = await request.json().catch(() => null)
  const city = String(body?.city ?? "").trim().slice(0, 100)
  if (!city) return Response.json({ error: "city is required" }, { status: 400 })

  const brief = {
    city,
    country: String(body.country ?? "").slice(0, 2),
    date: String(body.date ?? ""),
    dayInCity: Number(body.dayInCity) || 1,
    daysInCity: Number(body.daysInCity) || 1,
    interests: Array.isArray(body.interests) ? body.interests.slice(0, 20).map(String) : [],
    travellers: Number(body.travellers) || 1,
    dayStart: String(body.dayStart ?? "09:00"),
    dayEnd: String(body.dayEnd ?? "21:00"),
    avoid: Array.isArray(body.avoid) ? body.avoid.slice(0, 40).map(String) : [],
  }

  const result = await geminiJSON<{ items?: unknown }>({
    key,
    system: SYSTEM,
    prompt: JSON.stringify(brief),
    schema: SCHEMA,
    tag: "plan-day",
    temperature: 0.7,
  })
  if ("error" in result) {
    console.error(`[plan-day] ${result.error}`)
    return Response.json({ error: "Couldn't plan this day" }, { status: 502 })
  }
  const items = await withCoordinates(brief.city, brief.country, cleanItems(result.items))
  if (!items.length) {
    console.error("[plan-day] Gemini returned no usable activities")
    return Response.json({ error: "Couldn't plan this day" }, { status: 502 })
  }
  return Response.json({ items })
}
