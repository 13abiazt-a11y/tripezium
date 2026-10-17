"use client"

// "Listen" button: reads text aloud with the Sarah voice. Tap again to stop.
import { useEffect, useState } from "react"
import { Loader2, Square, Volume2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { speak, stopSpeech, unlockAudio, type SpeechState } from "@/lib/narration"

export function ListenButton({ text, label = "Listen" }: { text: () => string; label?: string }) {
  const [state, setState] = useState<SpeechState>("idle")
  const [error, setError] = useState("")

  useEffect(() => () => stopSpeech(), [])

  const onClick = () => {
    if (state !== "idle") return stopSpeech()
    setError("")
    unlockAudio()
    speak(text(), setState).catch((e: Error) => setError(e.message))
  }

  return (
    <span className="inline-flex flex-col items-end">
      <Button variant="outline" size="sm" onClick={onClick} aria-pressed={state !== "idle"} className="h-9 px-3">
        {state === "loading" ? (
          <Loader2 className="animate-spin" />
        ) : state === "playing" ? (
          <Square />
        ) : (
          <Volume2 />
        )}
        {state === "idle" ? label : "Stop"}
      </Button>
      {error ? <span className="mt-1 text-xs text-destructive">{error}</span> : null}
    </span>
  )
}
