// Feature switches.

// Costs are stored on every itinerary slot but only shown once the itinerary
// comes from C's backend with real prices. Turn on with NEXT_PUBLIC_SHOW_COSTS=true
// in .env.local, or flip this to true after the front end and back end are merged.
export const SHOW_COSTS = process.env.NEXT_PUBLIC_SHOW_COSTS === "true"
