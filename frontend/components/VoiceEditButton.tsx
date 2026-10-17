"use client"

// "🎤 Change my plan": tap, speak ("swap the museum on day 2 for a food tour"),
// tap again. The recording goes to /api/voice-edit, the changed days come back
// through onEdit, and the reply is read aloud with the Sarah voice.
// The text box does the same without a mic.
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Loader2, Mic, Send, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { speak, stopSpeech, unlockAudio } from "@/lib/narration"
import type { VoiceEditResult } from "@/lib/voice-edits"

const MAX_SECONDS = 15
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]

type Status = "idle" | "recording" | "working"

// The mic only works on https:// or localhost.
const noop = () => () => {}
const micSupported = () =>
  window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined"

export function VoiceEditButton({
  context,
  onEdit,
  footer,
}: {
  context: () => unknown // current itinerary + traveller details, sent with each request
  onEdit: (result: VoiceEditResult) => void
  footer?: React.ReactNode
}) {
  const [status, setStatus] = useState<Status>("idle")
  const [seconds, setSeconds] = useState(0)
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [last, setLast] = useState<{ you: string; reply: string } | null>(null)
  const micOk = useSyncExternalStore(noop, micSupported, () => true)

  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current)
      recorder.current?.stream.getTracks().forEach((t) => t.stop())
      stopSpeech()
    }
  }, [])

  async function send(payload: { audio?: Blob; text?: string }) {
    setStatus("working")
    setError("")
    try {
      const form = new FormData()
      if (payload.audio) form.append("audio", payload.audio)
      if (payload.text) form.append("text", payload.text)
      form.append("context", JSON.stringify(context()))
      const res = await fetch("/api/voice-edit", { method: "POST", body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) throw new Error(data?.error ?? "Something went wrong")
      const result = data as VoiceEditResult
      onEdit(result)
      setLast({ you: result.transcript, reply: result.reply })
      setText("")
      setStatus("idle")
      speak(result.reply).catch(() => {}) // the reply is on screen anyway
    } catch (e) {
      setError((e as Error).message)
      setStatus("idle")
    }
  }

  async function startRecording() {
    setError("")
    unlockAudio() // inside the tap, so the spoken reply can play later on iPhone
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError("Microphone blocked. Allow it in the browser, or type below.")
      return
    }
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      if (timer.current) clearInterval(timer.current)
      recorder.current = null
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" })
      if (blob.size < 1000) {
        setStatus("idle")
        setError("That was too short. Tap, speak, then tap again.")
        return
      }
      send({ audio: blob })
    }
    recorder.current = rec
    rec.start()
    setStatus("recording")
    setSeconds(0)
    const started = Date.now()
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS && rec.state === "recording") rec.stop()
    }, 250)
  }

  const onMic = () => {
    if (status === "recording") recorder.current?.stop()
    else if (status === "idle") startRecording()
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || status !== "idle") return
    unlockAudio()
    send({ text: t })
  }

  return (
    <section className="mb-4 rounded-xl bg-card p-3 ring-1 ring-foreground/10" aria-label="Change my plan">
      {micOk ? (
        <Button
          onClick={onMic}
          disabled={status === "working"}
          aria-pressed={status === "recording"}
          className={`h-11 w-full text-base ${status === "recording" ? "bg-destructive text-white hover:bg-destructive/90" : ""}`}
        >
          {status === "recording" ? (
            <>
              <Square /> Tap to finish · {MAX_SECONDS - seconds}s
            </>
          ) : status === "working" ? (
            <>
              <Loader2 className="animate-spin" /> Updating your plan…
            </>
          ) : (
            <>
              <Mic /> Change my plan
            </>
          )}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          The mic needs <span className="font-medium">https://</span> or localhost. You can still type a change below.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-2 flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. swap day 1 lunch for a ramen place"
          aria-label="Type a change to your plan"
          disabled={status !== "idle"}
          className="h-10"
        />
        <Button type="submit" variant="outline" disabled={!text.trim() || status !== "idle"} className="h-10 px-3">
          <Send /> Send
        </Button>
      </form>

      {status === "idle" && !last && !error ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Try “swap the museum on day 2 for a food tour”, “spend day 3 in Nara instead” or “read me the plan”.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {last ? (
        <div className="mt-2 space-y-1 text-sm" aria-live="polite">
          <p className="text-muted-foreground">
            You: <span className="text-foreground">“{last.you}”</span>
          </p>
          <p>{last.reply}</p>
        </div>
      ) : null}

      {footer}
    </section>
  )
}
