import { NextResponse } from "next/server";
import { ELEVENLABS_MODEL } from "@/lib/constants";

// POST /api/voice/tts — ElevenLabs TTS, server-side (key never leaves
// the server). Returns audio/mpeg on success, or JSON { fallback: true }
// so the client uses the browser SpeechSynthesis instead.

// Default prebuilt ElevenLabs voice (deep male, multilingual-capable).
const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return NextResponse.json({ fallback: true, message: "ElevenLabs non configurato." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ fallback: true, message: "Body non valido." });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ fallback: true, message: "Testo mancante." });
  }

  const voiceId =
    (typeof body.voiceId === "string" && body.voiceId) ||
    process.env.ELEVENLABS_VOICE_ID ||
    DEFAULT_VOICE_ID;

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL || ELEVENLABS_MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        cache: "no-store",
      },
    );

    if (!res.ok) {
      return NextResponse.json({
        fallback: true,
        message: `ElevenLabs error ${res.status}`,
      });
    }

    const audio = await res.arrayBuffer();
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json({
      fallback: true,
      message: (err as Error).message,
    });
  }
}
