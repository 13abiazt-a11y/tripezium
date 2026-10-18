// The traveller's own bookings (optional): where they're staying and the journeys they've booked.
// The API plans around both; these helpers show them on the right days.
import type { Journey, JourneyKind, Stay } from "./types"

export const JOURNEY_KINDS: { kind: JourneyKind; label: string }[] = [
  { kind: "flight", label: "Flight" },
  { kind: "train", label: "Train" },
  { kind: "bus", label: "Bus" },
  { kind: "ferry", label: "Ferry" },
  { kind: "car", label: "Drive" },
  { kind: "other", label: "Other" },
]

export const kindLabel = (k: JourneyKind) => JOURNEY_KINDS.find((x) => x.kind === k)?.label ?? "Journey"

const dateOf = (dt?: string | null) => (dt ? dt.slice(0, 10) : "")
const timeOf = (dt?: string | null) => (dt ? dt.slice(11, 16) : "")

/** Journeys that leave or arrive on this date. */
export function journeysOn(date: string, transport: Journey[] = []) {
  return transport.filter((j) => dateOf(j.departs) === date || dateOf(j.arrives) === date)
}

/** "19:00 London Heathrow → Tokyo Haneda 15:00 (next day)" */
export function describeJourney(j: Journey) {
  const arr = j.arrives ? ` ${timeOf(j.arrives)}${dateOf(j.arrives) !== dateOf(j.departs) ? " (+1)" : ""}` : ""
  return `${timeOf(j.departs)} ${j.origin} → ${j.destination}${arr}`
}

/** Where the traveller sets out from on this date: where they slept, else where they check in. */
export function stayOn(date: string, stays: Stay[] = []) {
  return stays.find((s) => s.checkIn < date && date <= s.checkOut) ?? stays.find((s) => s.checkIn === date) ?? null
}

export const sortJourneys = (t: Journey[]) => [...t].sort((a, b) => a.departs.localeCompare(b.departs))
export const sortStays = (s: Stay[]) => [...s].sort((a, b) => a.checkIn.localeCompare(b.checkIn))
