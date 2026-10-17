// Feature switches.

// Costs come from C's back end with real prices (local currency + home currency), so they're
// on by default. Set NEXT_PUBLIC_SHOW_COSTS=false to hide them.
export const SHOW_COSTS = process.env.NEXT_PUBLIC_SHOW_COSTS !== "false"
