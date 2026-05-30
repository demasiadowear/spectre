import { NextResponse } from "next/server";
import { geminiJSON } from "@/lib/gemini";
import { getLeads } from "@/lib/data";
import { AYRO_SYSTEM_PROMPT, buildCrmDigest, mockAyro } from "@/lib/ayro";
import type { ApiResponse } from "@/types";
import type { AyroResponse } from "@/types/voice";

// POST /api/ai/ayro — conversational agent. Interprets a free-form
// transcript against the live CRM and returns { speak, action }.
// Gemini first, deterministic mock fallback (basic data answers).

const ACTION_TYPES = [
  "navigate",
  "hunt",
  "search",
  "filter",
  "generate",
  "simulate",
  "none",
];

function sanitize(data: unknown): AyroResponse | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const speak = typeof o.speak === "string" ? o.speak.trim() : "";
  if (!speak) return null;
  let action: AyroResponse["action"];
  if (o.action && typeof o.action === "object") {
    const a = o.action as Record<string, unknown>;
    const type = typeof a.type === "string" && ACTION_TYPES.includes(a.type)
      ? (a.type as NonNullable<AyroResponse["action"]>["type"])
      : "none";
    action = {
      type,
      payload:
        a.payload && typeof a.payload === "object"
          ? (a.payload as Record<string, unknown>)
          : {},
    };
  }
  return { speak, action };
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

  const transcript =
    typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: transcript." },
      { status: 400 },
    );
  }

  const digest = buildCrmDigest(await getLeads());

  const ai = await geminiJSON<AyroResponse>(
    AYRO_SYSTEM_PROMPT,
    JSON.stringify({ transcript, crm: digest }),
    { complex: true, temperature: 0.4, maxOutputTokens: 1024 },
  );

  const data = sanitize(ai) ?? mockAyro(digest, transcript);

  return NextResponse.json<ApiResponse<AyroResponse>>({ success: true, data });
}
