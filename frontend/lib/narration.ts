// Spoken versions of the itinerary, and playback through /api/tts (ElevenLabs,
// voice "Sarah"). One shared <audio> element, so only one thing talks at a time.
import type { EditableDay } from "./voice-edits"

export const MAX_SPEECH_CHARS = 2400 // about 1.5 minutes

function spokenTime(t: string) {
  const [h, m] = t.split(":").map(Number)
  if (Number.isNaN(h)) return t
  const h12 = ((h + 11) % 12) + 1
  const ampm = h < 12 ? "a.m." : "p.m."
  return m ? `${h12}:${String(m).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`
}

function spokenDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (!h) return `${m} minutes`
  if (m === 30) return h === 1 ? "an hour and a half" : `${h} and a half hours`
  const hours = h === 1 ? "an hour" : `${h} hours`
  return m ? `${hours} and ${m} minutes` : hours
}

function spokenDate(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
}

const sentence = (s: string) => s.trim().replace(/[.!?]*$/, ".")

export function narrateDay(day: EditableDay, withTips = true) {
  const head = `Day ${day.day}, ${spokenDate(day.date)}, in ${day.city}.`
  if (!day.items.length) return `${head} Nothing is planned yet.`
  const lines = day.items.map((it, i) => {
    const lead = i === 0 ? "Start at" : i === day.items.length - 1 ? "Finally, at" : "At"
    const tip = withTips && it.tip ? ` Tip: ${sentence(it.tip)}` : ""
    return `${lead} ${spokenTime(it.time)}, ${it.name}, for about ${spokenDuration(it.durationMins)}.${tip}`
  })
  return `${head} ${lines.join(" ")}`
}

export function narrateTrip(days: EditableDay[]) {
  return clip(days.map((d) => narrateDay(d, false)).join(" "))
}

/** Cut long text at a sentence boundary so it stays under the TTS limit. */
export function clip(text: string, max = MAX_SPEECH_CHARS) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const end = cut.lastIndexOf(". ")
  return (end > max / 2 ? cut.slice(0, end + 1) : cut) + " That's the start of your plan."
}

// ---- playback ----

let audio: HTMLAudioElement | null = null
let current: AbortController | null = null

function player() {
  if (!audio) audio = new Audio()
  return audio
}

// A tiny silent WAV. Playing it during a tap "unlocks" audio on iPhone, so the
// reply can play later, after the network request finishes.
let silence = ""
function silentWav() {
  if (silence) return silence
  const n = 400
  const v = new DataView(new ArrayBuffer(44 + n))
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt ")
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  w(36, "data"); v.setUint32(40, n, true)
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128)
  let s = ""
  new Uint8Array(v.buffer).forEach((b) => (s += String.fromCharCode(b)))
  return (silence = "data:audio/wav;base64," + btoa(s))
}

/** Call inside a click/tap handler, before any await. */
export function unlockAudio() {
  stopSpeech()
  try {
    const a = player()
    a.src = silentWav()
    a.play().catch(() => {})
  } catch {
    // no audio support: speak() will report the error
  }
}

export function stopSpeech() {
  current?.abort()
  current = null
  if (audio) audio.pause()
}

export type SpeechState = "loading" | "playing" | "idle"

/** Speak `text` with the Sarah voice. Resolves when it finishes or is stopped. */
export async function speak(text: string, onState?: (s: SpeechState) => void) {
  stopSpeech()
  const ctrl = new AbortController()
  current = ctrl
  let url = ""
  onState?.("loading")
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clip(text) }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error ?? "Couldn't play the audio")
    }
    const blob = await res.blob()
    if (ctrl.signal.aborted) return
    url = URL.createObjectURL(blob)
    const a = player()
    a.src = url
    await new Promise<void>((resolve, reject) => {
      const done = () => resolve()
      a.onended = done
      a.onerror = () => reject(new Error("Couldn't play the audio"))
      ctrl.signal.addEventListener("abort", done)
      a.play().then(() => onState?.("playing"), reject)
    })
  } catch (e) {
    if (ctrl.signal.aborted) return
    throw e
  } finally {
    if (url) URL.revokeObjectURL(url)
    if (current === ctrl) current = null
    onState?.("idle")
  }
}
