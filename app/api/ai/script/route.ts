import { NextResponse } from "next/server";
import { geminiJSON } from "@/lib/gemini";
import { buildScriptUserMessage, COLD_CALL_PROMPT } from "@/lib/hunter/scripts";
import { generateMockScript } from "@/lib/hunter/mock-scripts";
import { scoreLead } from "@/lib/hunter/scorer";
import type { ApiResponse } from "@/types";
import type { ColdCallScript, RawLead } from "@/types/hunter";

// POST /api/ai/script — generate a cold-call script for a lead.
// Claude first, deterministic mock fallback otherwise.

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isValidScript(s: unknown): s is ColdCallScript {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.opening === "string" &&
    typeof o.solution === "string" &&
    typeof o.closing === "string" &&
    Array.isArray(o.pain_points) &&
    Array.isArray(o.objections)
  );
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

  const L = (body.lead ?? {}) as Record<string, unknown>;
  const name = str(L.name).trim();
  if (!name) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: lead.name." },
      { status: 400 },
    );
  }

  const category = str(body.category) || str(L.category) || "attività";
  const raw: RawLead = {
    id: str(L.id) || "lead",
    name,
    category: str(L.category) || category,
    address: str(L.address),
    phone: str(L.phone),
    rating: num(L.rating, 0),
    reviews: num(L.reviews, 0),
    has_website: Boolean(L.has_website),
    website: typeof L.website === "string" ? L.website : null,
  };
  const scored = scoreLead(raw);

  const ai = await geminiJSON<ColdCallScript>(
    COLD_CALL_PROMPT,
    buildScriptUserMessage(scored, category),
    { complex: true, maxOutputTokens: 4096 },
  );
  const script: ColdCallScript = isValidScript(ai)
    ? ai
    : generateMockScript(scored, category);

  return NextResponse.json<ApiResponse<ColdCallScript>>({
    success: true,
    data: script,
  });
}
