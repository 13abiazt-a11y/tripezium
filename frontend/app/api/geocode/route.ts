// City centre coordinates from OpenStreetMap (Nominatim). No key needed.
// GET /api/geocode?city=Kyoto&country=JP → { lat, lng }
// Cached here and in the browser (lib/geo.ts), so each city is looked up once.
import { cityCentre } from "@/lib/nominatim"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const city = (url.searchParams.get("city") ?? "").trim().slice(0, 100)
  const country = (url.searchParams.get("country") ?? "").trim().slice(0, 2)
  if (!city) return Response.json({ error: "city is required" }, { status: 400 })
  const hit = await cityCentre(city, country)
  return hit
    ? Response.json(hit, { headers: { "Cache-Control": "public, max-age=604800" } })
    : Response.json({ error: "not found" }, { status: 404 })
}
