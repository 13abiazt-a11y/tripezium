// Server-only helper: ask Gemini for JSON. Used by /api/voice-edit and /api/plan-day.
// Google changes what each model accepts, so if a setting is rejected (400) we
// retry with simpler settings. Prompts should also describe the JSON shape in
// words, so the answer is usable even without the schema.
import type { EditableItem } from "./voice-edits"

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash"

export async function geminiJSON<T>({
  key,
  system,
  prompt,
  schema,
  tag,
  temperature = 0.4,
}: {
  key: string
  system: string
  prompt: string
  schema: Record<string, unknown>
  tag: string // for log lines, e.g. "voice-edit"
  temperature?: number
}): Promise<T | { error: string }> {
  const thinking = /gemini-2\.5-flash(?!-lite)/.test(GEMINI_MODEL)
    ? { thinkingBudget: 0 }
    : /gemini-[3-9]/.test(GEMINI_MODEL)
      ? { thinkingLevel: "low" }
      : undefined
  const base = { temperature, responseMimeType: "application/json" }
  const attempts: Record<string, unknown>[] = [
    { ...base, responseSchema: schema, ...(thinking ? { thinkingConfig: thinking } : {}) },
    { ...base, responseSchema: schema },
    { ...base },
    { temperature },
  ]

  let res: Response | undefined
  let lastError = ""
  for (const generationConfig of attempts) {
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig,
        }),
      })
    } catch (e) {
      return { error: `Gemini request failed: ${(e as Error).message}` }
    }
    if (res.ok) break
    lastError = `Gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`
    if (res.status !== 400) return { error: lastError }
    console.warn(`[${tag}] retrying with simpler settings after ${lastError.slice(0, 160)}`)
  }
  if (!res?.ok) return { error: lastError }

  const data = await res.json().catch(() => null)
  const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
    .filter((p: { thought?: boolean }) => !p.thought) // skip thinking summaries
    .map((p: { text?: string }) => p.text ?? "")
    .join("")
  try {
    return JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")) as T
  } catch {
    return { error: `Gemini returned something that isn't JSON: ${text.slice(0, 200) || JSON.stringify(data).slice(0, 200)}` }
  }
}

export const ITEM_SCHEMA = {
  type: "OBJECT",
  properties: {
    time: { type: "STRING", description: "HH:mm, 24-hour" },
    name: { type: "STRING" },
    localName: { type: "STRING", description: "Name in the local language, only if different" },
    category: { type: "STRING" },
    durationMins: { type: "INTEGER" },
    note: { type: "STRING" },
    tip: { type: "STRING" },
    lat: { type: "NUMBER", description: "Latitude, WGS84" },
    lng: { type: "NUMBER", description: "Longitude, WGS84" },
  },
  required: ["time", "name", "category", "durationMins", "lat", "lng"],
}

export const ITEM_SHAPE = `{"time": "HH:mm", "name": string, "localName"?: string, "category": string, "durationMins": number, "note"?: string, "tip"?: string, "lat": number, "lng": number}`

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** Check and tidy activities from Gemini. `previous` keeps costs/coordinates of unchanged ones. */
export function cleanItems(raw: unknown, previous: EditableItem[] = []): EditableItem[] {
  if (!Array.isArray(raw)) return []
  return (raw as Partial<EditableItem>[])
    .filter((i) => i && typeof i.name === "string" && i.name.trim() && HHMM.test(String(i.time ?? "").trim()))
    .map((i) => {
      const [h, m] = String(i.time).trim().split(":")
      const item: EditableItem = {
        time: `${h.padStart(2, "0")}:${m}`,
        name: i.name!.trim(),
        category: String(i.category || "activity").toLowerCase(),
        durationMins: Math.max(15, Math.min(600, Math.round(Number(i.durationMins) || 60))),
      }
      if (i.localName && i.localName !== i.name) item.localName = String(i.localName)
      if (i.note) item.note = String(i.note)
      if (i.tip) item.tip = String(i.tip)
      const lat = Number(i.lat)
      const lng = Number(i.lng)
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) {
        item.lat = Math.round(lat * 1e5) / 1e5
        item.lng = Math.round(lng * 1e5) / 1e5
      }
      // Keep the estimated cost and location when an activity is unchanged.
      const same = previous.find((b) => b.name === item.name)
      if (same?.cost) item.cost = same.cost
      if (item.lat === undefined && same?.lat !== undefined && same.lng !== undefined) {
        item.lat = same.lat
        item.lng = same.lng
      }
      return item
    })
    .sort((a, b) => a.time.localeCompare(b.time))
}
