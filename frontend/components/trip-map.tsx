"use client"

// Map on the itinerary page (Leaflet + OpenStreetMap tiles, no API key).
// "This day": numbered pins in visit order, joined by a dashed line, coloured by
//             category. Tap a pin to highlight that stop in the list.
// "Whole trip": each city in route order with its number of days. Tap a city
//               to jump to its first day.
import "leaflet/dist/leaflet.css"

import { useEffect, useRef, useState } from "react"
import type * as Leaflet from "leaflet"

import type { LatLng } from "@/lib/geo"

export type MapStop = { n: number; name: string; category: string; lat: number; lng: number }
export type MapCity = { city: string; country: string; days: number; firstDay: number; active: boolean; at?: LatLng | null }
export type MapMode = "day" | "trip"

const CATEGORY_COLOURS: [RegExp, string, string][] = [
  [/food|restaurant|caf|market|bar|lunch|dinner|breakfast|ramen|street/i, "#e07a2f", "Food"],
  [/night|club|drink|pub/i, "#7656c9", "Nightlife"],
  [/nature|park|garden|hike|beach|view|lake|mountain/i, "#3b8f4a", "Nature"],
  [/shop/i, "#c94f86", "Shopping"],
  [/museum|art|gallery|exhibit/i, "#2f76b8", "Culture"],
]
const SIGHTS = "#009b72" // brand green (--primary)

export function categoryColour(category: string) {
  return CATEGORY_COLOURS.find(([re]) => re.test(category))?.[1] ?? SIGHTS
}
export function categoryLabel(category: string) {
  return CATEGORY_COLOURS.find(([re]) => re.test(category))?.[2] ?? "Sights"
}

const pin = (n: number, colour: string, selected: boolean) => `
  <div style="width:28px;height:28px;border-radius:9999px;background:${colour};color:#fff;display:flex;align-items:center;
    justify-content:center;font:600 13px/1 system-ui,sans-serif;border:2px solid #fff;
    box-shadow:0 1px 4px rgba(0,0,0,.35)${selected ? ",0 0 0 4px rgba(0,155,114,.35)" : ""};
    transform:scale(${selected ? 1.25 : 1});transition:transform .15s">${n}</div>`

const cityLabel = (i: number, c: MapCity) => `
  <div style="white-space:nowrap;display:inline-flex;align-items:center;gap:6px;
    padding:4px 10px 4px 4px;border-radius:9999px;font:600 12px/1 system-ui,sans-serif;
    background:${c.active ? SIGHTS : "#fff"};color:${c.active ? "#fff" : "#1f2937"};
    box-shadow:0 1px 4px rgba(0,0,0,.3);border:1px solid ${c.active ? SIGHTS : "rgba(0,0,0,.08)"}">
    <span style="width:20px;height:20px;border-radius:9999px;display:flex;align-items:center;justify-content:center;
      background:${c.active ? "#fff" : SIGHTS};color:${c.active ? SIGHTS : "#fff"}">${i + 1}</span>
    ${escapeHtml(c.city)} · ${c.days}d</div>`

// Rough label width so the whole pill is tappable; the number sits on the city.
const labelWidth = (c: MapCity) => 48 + Math.round((c.city.length + String(c.days).length + 3) * 7)

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!)
}

export function TripMap({
  mode,
  onModeChange,
  stops,
  dayCity,
  cities,
  selected,
  onSelectStop,
  onSelectCity,
}: {
  mode: MapMode
  onModeChange: (m: MapMode) => void
  stops: MapStop[] // this day's stops that have coordinates
  dayCity: { city: string; at?: LatLng | null } | null // fallback when the day has no coordinates
  cities: MapCity[]
  selected: number | null
  onSelectStop: (n: number) => void
  onSelectCity: (firstDay: number) => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<Leaflet.Map | null>(null)
  const layer = useRef<Leaflet.LayerGroup | null>(null)
  const L = useRef<typeof Leaflet | null>(null)
  const [ready, setReady] = useState(false)
  const refit = useRef<() => void>(() => {})

  // Latest callbacks, so the drawing effect doesn't re-run when they change identity.
  const handlers = useRef({ onSelectStop, onSelectCity })
  useEffect(() => {
    handlers.current = { onSelectStop, onSelectCity }
  })

  // Create the map once, on the client (Leaflet needs `window`).
  useEffect(() => {
    let cancelled = false
    import("leaflet").then((mod) => {
      if (cancelled || !el.current || map.current) return
      const lf = (mod.default ?? mod) as typeof Leaflet
      L.current = lf
      const m = lf.map(el.current, { scrollWheelZoom: false, zoomControl: false, attributionControl: true })
      lf.control.zoom({ position: "bottomright" }).addTo(m)
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m)
      m.setView([20, 0], 2)
      layer.current = lf.layerGroup().addTo(m)
      map.current = m
      // The box can change size after the map is created (CSS loading, layout
      // settling, rotating a phone): re-measure and re-fit whenever it does.
      const ro = new ResizeObserver(() => {
        m.invalidateSize({ animate: false })
        refit.current()
      })
      ro.observe(el.current)
      observer = ro
      setReady(true)
    })
    let observer: ResizeObserver | null = null
    return () => {
      cancelled = true
      observer?.disconnect()
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Redraw whenever what we show changes.
  const data = JSON.stringify({ mode, stops, dayCity, cities, selected })
  useEffect(() => {
    const lf = L.current
    const m = map.current
    const group = layer.current
    if (!ready || !lf || !m || !group) return
    group.clearLayers()
    const { mode, stops, dayCity, cities, selected } = JSON.parse(data) as {
      mode: MapMode
      stops: MapStop[]
      dayCity: { city: string; at?: LatLng | null } | null
      cities: MapCity[]
      selected: number | null
    }

    m.invalidateSize({ animate: false })
    const fit = (points: [number, number][], single: number, maxZoom: number) => {
      refit.current = () => fit(points, single, maxZoom)
      if (points.length === 1) m.setView(points[0], single, { animate: false })
      // Extra room at the top for the toggle and on the right for the zoom buttons.
      else if (points.length > 1)
        m.fitBounds(lf.latLngBounds(points), { paddingTopLeft: [40, 60], paddingBottomRight: [60, 30], maxZoom, animate: false })
    }

    if (mode === "trip") {
      const placed = cities.map((c, i) => ({ c, i })).filter(({ c }) => c.at)
      const points = placed.map(({ c }) => [c.at!.lat, c.at!.lng] as [number, number])
      if (points.length > 1) lf.polyline(points, { color: SIGHTS, weight: 2.5, dashArray: "6 8", opacity: 0.8 }).addTo(group)
      for (const { c, i } of placed) {
        lf.marker([c.at!.lat, c.at!.lng], {
          icon: lf.divIcon({ className: "", html: cityLabel(i, c), iconSize: [labelWidth(c), 30], iconAnchor: [14, 15] }),
          zIndexOffset: c.active ? 1000 : 0,
          keyboard: true,
          title: `${c.city}, ${c.days} days`,
        })
          .on("click", () => handlers.current.onSelectCity(c.firstDay))
          .addTo(group)
      }
      fit(points, 9, 9)
      return
    }

    if (stops.length) {
      const points = stops.map((s) => [s.lat, s.lng] as [number, number])
      if (points.length > 1) lf.polyline(points, { color: "#334155", weight: 2, dashArray: "4 6", opacity: 0.6 }).addTo(group)
      for (const s of stops) {
        lf.marker([s.lat, s.lng], {
          icon: lf.divIcon({ className: "", html: pin(s.n, categoryColour(s.category), s.n === selected), iconSize: [28, 28], iconAnchor: [14, 14] }),
          zIndexOffset: s.n === selected ? 1000 : 0,
          title: `${s.n}. ${s.name}`,
          keyboard: true,
        })
          .on("click", () => handlers.current.onSelectStop(s.n))
          .addTo(group)
      }
      const sel = stops.find((s) => s.n === selected)
      if (sel) {
        refit.current = () => m.setView([sel.lat, sel.lng], Math.max(m.getZoom(), 14), { animate: false })
        m.setView([sel.lat, sel.lng], Math.max(m.getZoom(), 14), { animate: true })
      } else fit(points, 15, 15)
    } else if (dayCity?.at) {
      lf.circleMarker([dayCity.at.lat, dayCity.at.lng], { radius: 9, color: "#fff", weight: 3, fillColor: SIGHTS, fillOpacity: 1 })
        .bindTooltip(dayCity.city, { permanent: true, direction: "top", offset: [0, -8] })
        .addTo(group)
      const at: [number, number] = [dayCity.at.lat, dayCity.at.lng]
      refit.current = () => m.setView(at, 11, { animate: false })
      refit.current()
    }
  }, [ready, data])

  const noDayPins = mode === "day" && !stops.length
  return (
    <div className="relative isolate mb-4 h-56 overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10">
      <div ref={el} className="size-full" role="region" aria-label={mode === "day" ? "Map of this day" : "Map of the whole trip"} />

      {cities.length > 1 ? (
        <div className="absolute top-2 left-2 z-[1000] flex rounded-full bg-background/95 p-0.5 text-xs font-medium shadow ring-1 ring-foreground/10">
          {(["day", "trip"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              aria-pressed={mode === m}
              className={`rounded-full px-3 py-1.5 transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {m === "day" ? "This day" : "Whole trip"}
            </button>
          ))}
        </div>
      ) : null}

      {noDayPins ? (
        <p className="absolute right-2 bottom-2 left-2 z-[1000] rounded-lg bg-background/95 px-2.5 py-1.5 text-center text-xs text-muted-foreground shadow ring-1 ring-foreground/10 sm:right-12">
          {dayCity?.at ? "Exact stops appear here once the plan has them." : `Finding ${dayCity?.city ?? "the city"} on the map…`}
        </p>
      ) : null}
    </div>
  )
}
