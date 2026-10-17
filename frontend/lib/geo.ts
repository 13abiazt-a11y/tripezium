"use client"

// Coordinates for the map, via /api/geocode (OpenStreetMap): city centres, and
// named places that came without coordinates. Cached in localStorage so each
// one is only looked up once per browser.
import { useEffect, useState } from "react"

export type LatLng = { lat: number; lng: number }

const KEY = "geo-cache-v2" // v2: place lookups now stay near their city

function readCache(): Record<string, LatLng | null> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, LatLng | null>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // storage blocked: we'll just look it up again next time
  }
}

/** Distance in km between two points. */
export function distanceKm(a: LatLng, b: LatLng) {
  const r = (x: number) => (x * Math.PI) / 180
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

export const cityKey = (city: string, country: string, place?: string) =>
  `${country.toUpperCase()}:${city.toLowerCase()}${place ? `:${place.toLowerCase()}` : ""}`

type Query = { city: string; country: string; place?: string }

/** Coordinates for each city (or place in a city), filled in as lookups finish. Missing = not known (yet). */
export function useCityCoords(queries: Query[]) {
  const [coords, setCoords] = useState<Record<string, LatLng | null>>({})
  const wanted = [...new Set(queries.map((c) => `${c.country}|${c.city}|${c.place ?? ""}`.replace(/;/g, ",")))].join(";")

  useEffect(() => {
    let cancelled = false
    const list = wanted ? wanted.split(";").map((s) => s.split("|") as [string, string, string]) : []
    const cache = readCache()
    const found: Record<string, LatLng | null> = {}
    const missing: [string, string, string][] = []
    for (const [country, city, place] of list) {
      const k = cityKey(city, country, place)
      if (k in cache) found[k] = cache[k]
      else missing.push([country, city, place])
    }
    // Async so we don't set state synchronously inside the effect.
    queueMicrotask(() => !cancelled && setCoords((c) => ({ ...c, ...found })))

    // Named places: one request per city to /api/locate (Gemini + OpenStreetMap).
    const placesTask = async () => {
      const byCity = new Map<string, { country: string; city: string; names: string[] }>()
      for (const [country, city, place] of missing) {
        if (!place) continue
        const k = `${country}|${city}`
        if (!byCity.has(k)) byCity.set(k, { country, city, names: [] })
        byCity.get(k)!.names.push(place)
      }
      for (const { country, city, names } of byCity.values()) {
        if (cancelled) return
        try {
          const res = await fetch("/api/locate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ city, country, names }),
          })
          if (!res.ok) continue
          const { coords: found } = (await res.json()) as { coords: Record<string, LatLng | null> }
          const update = Object.fromEntries(names.map((n) => [cityKey(city, country, n), found?.[n] ?? null]))
          writeCache({ ...readCache(), ...update })
          if (!cancelled) setCoords((c) => ({ ...c, ...update }))
        } catch {
          // try again next visit
        }
      }
    }

    // City centres, one at a time: OpenStreetMap asks for ~1 request a second.
    const citiesTask = async () => {
      for (const [country, city, place] of missing) {
        if (place) continue
        if (cancelled) return
        const k = cityKey(city, country)
        let value: LatLng | null = null
        try {
          const res = await fetch(`/api/geocode?${new URLSearchParams({ city, country })}`)
          if (res.ok) value = await res.json()
          else if (res.status !== 404) continue // server problem: try again next visit
        } catch {
          continue
        }
        writeCache({ ...readCache(), [k]: value })
        if (!cancelled) setCoords((c) => ({ ...c, [k]: value }))
      }
    }

    void placesTask()
    void citiesTask()
    return () => {
      cancelled = true
    }
  }, [wanted])

  return coords
}
