"use client"

// Opening animation: the Tripezium logo pops in, the name rises, then the whole
// screen slides up like a curtain to reveal the trip form underneath.
// Plays once per page load (not when navigating back to this page). Tap to skip.
import { useEffect, useState } from "react"
import Image from "next/image"

let played = false

export function Splash() {
  const [phase, setPhase] = useState<"show" | "leave" | "done">(played ? "done" : "show")

  useEffect(() => {
    if (phase !== "show") return
    played = true
    const t = setTimeout(() => setPhase("leave"), 2100)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === "done") return null

  return (
    <div
      role="presentation"
      onClick={() => setPhase("leave")}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && phase === "leave") setPhase("done")
      }}
      className="tz-anim fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-b-[2.5rem] bg-background"
      style={phase === "leave" ? { animation: "tz-exit 0.75s cubic-bezier(0.7, 0, 0.2, 1) forwards" } : undefined}
    >
      <div
        aria-hidden
        className="tz-anim pointer-events-none absolute inset-x-0 top-1/2 h-72 -translate-y-1/2 bg-[radial-gradient(closest-side,var(--secondary),transparent)]"
        style={{ animation: "tz-fade 1.2s ease-out both" }}
      />
      <Image
        src="/tripezium-mark.png"
        alt=""
        width={160}
        height={160}
        priority
        className="tz-anim relative size-36 drop-shadow-sm"
        style={{ animation: "tz-pop 0.9s cubic-bezier(0.2, 0.9, 0.3, 1.25) both" }}
      />
      <h1
        className="tz-anim relative mt-5 text-4xl font-bold tracking-tight text-foreground"
        style={{ animation: "tz-rise 0.6s 0.45s ease-out both" }}
      >
        Tripezium
      </h1>
      <p
        className="tz-anim relative mt-2 text-sm text-muted-foreground"
        style={{ animation: "tz-rise 0.6s 0.7s ease-out both" }}
      >
        One trip. More places.
      </p>
      <div
        aria-hidden
        className="tz-anim relative mt-8 h-1 w-24 overflow-hidden rounded-full bg-muted"
        style={{ animation: "tz-rise 0.4s 0.9s ease-out both" }}
      >
        <div className="tz-anim h-full rounded-full bg-primary" style={{ animation: "tz-load 1.2s 0.9s ease-in-out both" }} />
      </div>
      <span className="sr-only">Loading Tripezium</span>
    </div>
  )
}
