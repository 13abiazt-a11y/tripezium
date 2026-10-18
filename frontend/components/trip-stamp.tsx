// Souvenir-badge icon for a trip on the home page: a scalloped stamp with the
// city on a ribbon and a small icon, in the trip's own colour.
import { useId } from "react"

import type { Trip } from "@/lib/types"

// Colours that sit well on white cards next to the brand green. A trip always
// gets the same one (picked from its id), so Paris stays blue.
export const PALETTE = ["#d9622b", "#2c63b0", "#8a4f9e", "#0f8b8d", "#b07d12", "#c2456e", "#5e7d2b"]

export function tripColour(id: string) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

type Kind = "plane" | "sun" | "tower" | "mountain"

const BEACH_CITIES = new Set(
  "miami barcelona nice lisbon honolulu cancun cancún bali phuket rio de janeiro sydney malaga málaga ibiza santorini mykonos dubrovnik split goa maldives".split(" "),
)

/** Pick a small icon from the trip: Paris gets the tower, beach trips a sun, outdoorsy ones mountains. */
function kindOf(trip: Trip, city: string): Kind {
  const c = city.toLowerCase()
  if (c === "paris") return "tower"
  const interests = new Set(trip.interests)
  if (interests.has("beaches") || BEACH_CITIES.has(c)) return "sun"
  if (["hiking", "nature", "alps", "skiing", "national-parks"].some((x) => interests.has(x))) return "mountain"
  return "plane"
}

function Icon({ kind, colour }: { kind: Kind; colour: string }) {
  // Drawn in a 24×24 box, placed in the top half of the badge.
  const g = { transform: "translate(38 29) scale(.95) translate(-12 -12)" }
  if (kind === "sun")
    return (
      <g {...g} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round">
        <circle cx="12" cy="12" r="4.2" fill={colour} />
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
      </g>
    )
  if (kind === "tower")
    return (
      <g {...g} fill="none" stroke={colour} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v2M9.6 21c.6-6 1.4-10 2.4-17 1 7 1.8 11 2.4 17M7 21c1.5-3 3-4.2 5-4.2s3.5 1.2 5 4.2M9.3 12h5.4M5.5 21h13" />
      </g>
    )
  if (kind === "mountain")
    return (
      <g {...g} fill="none" stroke={colour} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 20 9 9l4 6.5 2.5-3.5 6 8z" fill={colour} fillOpacity={0.15} />
        <path d="M7.6 11.4 9 9l1.4 2.4" />
      </g>
    )
  return (
    <g {...g}>
      <path
        d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
        fill={colour}
      />
    </g>
  )
}

// The scalloped outline: 18 points, alternating radius.
const SCALLOP = Array.from({ length: 36 }, (_, i) => {
  const r = i % 2 ? 31 : 35
  const a = (Math.PI * i) / 18
  return `${(38 + r * Math.cos(a)).toFixed(2)},${(38 + r * Math.sin(a)).toFixed(2)}`
}).join(" ")

export function TripStamp({ trip, city, year, colour: given }: { trip: Trip; city: string; year?: string; colour?: string }) {
  const ink = `ink-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`
  const colour = given ?? tripColour(trip.id)
  const name = city.toUpperCase()
  // Long names get smaller type so they fit on the ribbon.
  const size = name.length > 11 ? 5.8 : name.length > 8 ? 6.6 : 8
  // Squeeze anything still too wide to fit inside the ribbon.
  const fit = name.length * size * 0.72 > 52 ? { textLength: 52, lengthAdjust: "spacingAndGlyphs" as const } : {}
  return (
    <svg viewBox="0 0 76 76" className="size-[72px] shrink-0" aria-hidden>
      <defs>
        {/* A light printed-ink texture */}
        <filter id={ink} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves={2} seed={4} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.55" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${ink})`}>
        <polygon points={SCALLOP} fill="none" stroke={colour} strokeWidth={2.2} strokeLinejoin="round" />
        <circle cx="38" cy="38" r="25" fill="none" stroke={colour} strokeWidth={1} strokeDasharray="2 2" />
        <Icon kind={kindOf(trip, city)} colour={colour} />
        <rect x="9" y="40" width="58" height="13" fill={colour} />
        <path d="M9 40l-5 6.5 5 6.5M67 40l5 6.5-5 6.5" fill={colour} />
        <text
          x="38"
          y="49.5"
          textAnchor="middle"
          fontSize={size}
          fontWeight={900}
          letterSpacing={fit.textLength ? 0 : 1.1}
          fill="#fff"
          fontFamily="inherit"
          {...fit}
        >
          {name}
        </text>
        {year ? (
          <text x="38" y="61" textAnchor="middle" fontSize={5.5} fontWeight={800} letterSpacing={1} fill={colour} fontFamily="inherit">
            {year}
          </text>
        ) : null}
      </g>
    </svg>
  )
}

/** "24 days to go", "Starts tomorrow", "Happening now"… from the trip's dates. */
export function countdown(start: string, end: string, today = new Date()) {
  if (!start) return null
  const day = (d: string) => Date.parse(d + "T00:00:00Z") / 86_400_000
  const now = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000)
  const toStart = day(start) - now
  const toEnd = (end ? day(end) : day(start)) - now
  if (toEnd < 0) return { text: "Done", days: toStart, past: true }
  if (toStart <= 0) return { text: "Happening now", days: 0, past: false }
  if (toStart === 1) return { text: "Starts tomorrow", days: 1, past: false }
  return { text: `${toStart} days to go`, days: toStart, past: false }
}
