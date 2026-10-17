import type { Money } from "./types"

// Currencies offered for the trip budget (the traveller's home currency).
export const CURRENCIES = [
  "GBP", "EUR", "USD", "JPY", "AUD", "CAD", "CHF", "CNY", "HKD", "INR", "SGD", "NZD",
  "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "TRY", "AED", "THB", "KRW", "MXN", "BRL", "ZAR",
]

export function formatMoney({ amount, currency }: Money) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${Math.round(amount)} ${currency}`
  }
}

/** Sum costs that share one currency; returns one Money per currency. */
export function totals(costs: (Money | undefined)[]): Money[] {
  const by = new Map<string, number>()
  for (const c of costs) if (c) by.set(c.currency, (by.get(c.currency) ?? 0) + c.amount)
  return [...by].map(([currency, amount]) => ({ currency, amount }))
}
