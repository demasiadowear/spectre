import { NextResponse } from "next/server";
import { geminiJSON } from "@/lib/gemini";
import { WHISPER_SYSTEM_PROMPT } from "@/lib/constants";
import { mockWhisper, type WhisperInput } from "@/lib/mock-ai";
import type { ApiResponse, WhisperResponse } from "@/types";

// POST /api/ai/whisper — analyse the recent transcript and return
// the dominant objection + 3 counter-responses. Claude first, mock
// fallback otherwise (or on failure).

function toMessage(raw: unknown): { speaker: string; text: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) return null;
  const speaker = typeof obj.speaker === "string" ? obj.speaker : "cliente";
  return { speaker, text };
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Body JSON non valido." },
      { status: 400 },
    );
  }

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .map(toMessage)
    .filter((m): m is { speaker: string; text: string } => m !== null);

  if (messages.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Nessun messaggio da analizzare." },
      { status: 400 },
    );
  }

  const input: WhisperInput = {
    lead_name: typeof body.lead_name === "string" ? body.lead_name : undefined,
    company: typeof body.company === "string" ? body.company : undefined,
    messages,
  };

  const ai = await geminiJSON<WhisperResponse>(
    WHISPER_SYSTEM_PROMPT,
    JSON.stringify(input),
    { temperature: 0.3 },
  );
  const data = ai ?? mockWhisper(input);

  return NextResponse.json<ApiResponse<WhisperResponse>>({
    success: true,
    data,
  });
}
