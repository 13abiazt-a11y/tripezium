// Coordinates for named activities in a city (for activities saved without them).
// POST { city, country, names: string[] } → { coords: { [name]: { lat, lng } | null } }
import { locatePlaces } from "@/lib/locate"

export const maxDuration = 30 // seconds (Vercel)

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const city = String(body?.city ?? "").trim().slice(0, 100)
  const country = String(body?.country ?? "").trim().slice(0, 2)
  const names = Array.isArray(body?.names) ? body.names.slice(0, 20).map((n: unknown) => String(n).slice(0, 150)) : []
  if (!city || !names.length) return Response.json({ error: "city and names are required" }, { status: 400 })
  const coords = await locatePlaces(city, country, names)
  return Response.json({ coords })
}
