// Voice / typed changes to the itinerary.
// POST multipart form:
//   audio   (optional) recording from the mic → ElevenLabs Speech-to-Text (Scribe)
//   text    (optional) typed request, used when there is no audio
//   context JSON: { days, activeDay, travellers, interests, dayStart, dayEnd }
// → { transcript, intent, reply, changes } (only the days that changed)
// Needs ELEVENLABS_API_KEY (with Speech to Text) and GEMINI_API_KEY in .env.local.

import { cleanItems, geminiJSON, ITEM_SCHEMA, ITEM_SHAPE } from "@/lib/gemini"
import { withCoordinates } from "@/lib/locate"
import type { DayChange, EditableDay, VoiceEditResult } from "@/lib/voice-edits"

export const maxDuration = 30 // seconds (Vercel)

const STT_MODEL = process.env.ELEVENLABS_STT_MODEL_ID || "scribe_v1"
const MAX_AUDIO_BYTES = 10_000_000

type Context = {
  days: EditableDay[]
  currency?: string // the trip's home currency: Gemini estimates new activities' costs in it
  activeDay?: number
  travellers?: number
  interests?: string[]
  dayStart?: string
  dayEnd?: string
}

const fail = (status: number, error: string, log: string) => {
  console.error(`[voice-edit] ${log}`)
  return Response.json({ error }, { status })
}

export async function POST(request: Request) {
  const elevenKey = process.env.ELEVENLABS_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, "Bad request", "request was not multipart form data")
  }

  const audio = form.get("audio")
  const typed = String(form.get("text") ?? "").trim()
  let context: Context
  try {
    context = JSON.parse(String(form.get("context") ?? ""))
    if (!Array.isArray(context.days)) throw new Error("no days")
  } catch {
    return fail(400, "Bad request", "context missing or not valid JSON")
  }

  const hasAudio = audio instanceof Blob && audio.size > 0
  if (!geminiKey || (hasAudio && !elevenKey)) {
    return fail(
      500,
      "Voice editing not configured",
      `missing ${[!geminiKey && "GEMINI_API_KEY", hasAudio && !elevenKey && "ELEVENLABS_API_KEY"].filter(Boolean).join(" and ")} in .env.local (restart the dev server after adding)`,
    )
  }

  // 1. Speech to text
  let transcript = typed
  if (hasAudio) {
    if (audio.size > MAX_AUDIO_BYTES) return fail(413, "That recording is too long", `audio too big: ${audio.size} bytes`)
    const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm"
    const stt = new FormData()
    stt.append("model_id", STT_MODEL)
    stt.append("file", audio, `speech.${ext}`)
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": elevenKey! },
      body: stt,
    })
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300)
      return fail(502, "Couldn't hear that", `ElevenLabs STT ${res.status}: ${body}`)
    }
    const data = await res.json().catch(() => null)
    transcript = String(data?.text ?? "").trim()
  }
  if (!transcript) return fail(422, "Couldn't hear that. Try again a bit louder?", "empty transcript")

  // 2. Gemini decides what changes
  const result = await askGemini(geminiKey, transcript, context)
  if ("error" in result) return fail(502, "Couldn't update the plan", result.error)

  // Make sure every changed activity can go on the map (and is in the right city).
  const changes = await Promise.all(
    result.changes.map(async (c) => ({ ...c, items: await withCoordinates(c.city, c.country, c.items) })),
  )
  const body: VoiceEditResult = { transcript, ...result, changes }
  return Response.json(body)
}

const SYSTEM = `You are Tripezium's trip assistant. You change a traveller's day-by-day itinerary from a short spoken or typed request.

You get the current itinerary as JSON (days numbered from 1; each has a date, a city, an ISO country code and timed items) plus the traveller's details, and the request. The request may come from speech-to-text, so allow for small transcription mistakes in place names.

Pick the intent:
- "edit": the request changes the plan: swap, add, remove, move or retime an activity; make a day lighter or busier; change a day's city ("swap Kyoto for Osaka", "spend day 3 in Nara instead").
- "read": the request asks to hear the plan ("read me the plan", "what's on day 2?").
- "answer": any other question about the trip ("what time do we start on day 2?"). Changes nothing.

Rules for edits:
- Put in "changes" ONLY the days that change, each with its FULL new list of items. Leave unchanged days out.
- Keep items you weren't asked to change exactly as they are (same time, name, localName, category, durationMins, note, tip).
- New activities must be real, specific places or experiences in that day's city (a named restaurant, museum, market, tour company…), not generic placeholders. Add a short practical tip when it helps.
- Times are 24-hour "HH:mm", sorted, not overlapping, within the traveller's day start and end, with sensible meal times. Use travel time between activities.
- Every new item has "cost": a realistic estimate per person in the traveller's currency ("currency"), 0 if free. Keep the cost of unchanged items.
- Every item has "lat" and "lng": the place's real coordinates (WGS84, 4 decimals), used to put it on a map. Keep the coordinates of unchanged items.
- category is one or two lowercase words, e.g. food, museum, temple, landmark, nature, shopping, nightlife, art, tour.
- When a day moves to a different city, set its new "city" and "country" (ISO 3166-1 alpha-2) and replace all its items with a fresh plan for that city that fits the traveller's interests. "Swap city A for city B" applies to every day currently in city A. Days that keep their city repeat the same city and country.
- "today" or "this day" means activeDay, the day the traveller is looking at. If a request is a little ambiguous, make the most sensible change rather than asking.

The "reply" is spoken by a text-to-speech voice, so write natural speech: no lists, markdown, emoji or symbols, and say times like "9 a.m.".
- edit: one or two short sentences saying what changed, e.g. "Done. On day 2 I swapped the museum for a street food tour at 2 p.m."
- answer: a short direct answer. "changes" is empty.
- read: read the requested day, or the whole trip briefly, in under 220 words. "changes" is empty.
- If the request isn't about the trip, say briefly what you can help with. "changes" is empty.`

const JSON_SHAPE = `

Reply with JSON only, exactly this shape:
{"intent": "edit" | "answer" | "read", "reply": string, "changes": [{"day": number, "city": string, "country": string, "items": [${ITEM_SHAPE}]}]}`

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING", enum: ["edit", "answer", "read"] },
    reply: { type: "STRING" },
    changes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          day: { type: "INTEGER" },
          city: { type: "STRING" },
          country: { type: "STRING", description: "ISO 3166-1 alpha-2" },
          items: { type: "ARRAY", items: ITEM_SCHEMA },
        },
        required: ["day", "city", "country", "items"],
      },
    },
  },
  required: ["intent", "reply", "changes"],
}

async function askGemini(
  key: string,
  transcript: string,
  context: Context,
): Promise<Omit<VoiceEditResult, "transcript"> | { error: string }> {
  // Costs aren't something the assistant edits; keep the prompt small.
  const days = context.days.slice(0, 60).map((d) => ({
    ...d,
    // Costs as plain numbers in the trip currency; the rest isn't for the assistant.
    items: d.items.map((i) => ({ ...i, cost: i.cost?.amount, localCost: undefined, status: undefined })),
  }))
  const prompt = `Traveller and itinerary:\n${JSON.stringify({ ...context, days })}\n\nRequest: "${transcript}"`

  const parsed = await geminiJSON<{ intent?: string; reply?: string; changes?: unknown[] }>({
    key,
    system: SYSTEM + JSON_SHAPE,
    prompt,
    schema: RESPONSE_SCHEMA,
    tag: "voice-edit",
  })
  if ("error" in parsed) return parsed

  const intent = parsed.intent === "edit" || parsed.intent === "read" ? parsed.intent : "answer"
  const currency = /^[A-Z]{3}$/.test(context.currency ?? "") ? context.currency : undefined
  const changes = intent === "edit" ? cleanChanges(parsed.changes, context.days, currency) : []
  const reply = String(parsed.reply ?? "").trim() || (changes.length ? "Done, I've updated your plan." : "Sorry, I didn't catch that.")
  return { intent, reply, changes }
}

function cleanChanges(raw: unknown, days: EditableDay[], currency?: string): DayChange[] {
  if (!Array.isArray(raw)) return []
  const out = new Map<number, DayChange>()
  for (const c of raw as Partial<DayChange>[]) {
    const day = Number(c?.day)
    const base = days[day - 1]
    if (!base || !Array.isArray(c.items)) continue
    const items = cleanItems(c.items, base.items, currency)
    const country = /^[A-Za-z]{2}$/.test(String(c.country ?? "")) ? String(c.country).toUpperCase() : base.country
    out.set(day, { day, city: String(c.city || base.city).trim(), country, items })
  }
  return [...out.values()]
}
