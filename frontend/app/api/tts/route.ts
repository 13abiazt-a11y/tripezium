// Text to speech with ElevenLabs. POST { text } → audio/mpeg.
// Needs ELEVENLABS_API_KEY (with Text to Speech permission) in .env.local.

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL" // "Sarah"
const MODEL_ID = process.env.ELEVENLABS_TTS_MODEL_ID || "eleven_flash_v2_5"
const MAX_CHARS = 2500

export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) {
    console.error("[tts] ELEVENLABS_API_KEY is not set (add it to .env.local and restart)")
    return Response.json({ error: "Listen is not configured" }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_CHARS) : ""
  if (!text) return Response.json({ error: "Nothing to read" }, { status: 400 })

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    },
  )
  if (!res.ok || !res.body) {
    console.error("[tts] ElevenLabs", res.status, (await res.text().catch(() => "")).slice(0, 300))
    return Response.json({ error: "Couldn't make the audio" }, { status: 502 })
  }
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } })
}
