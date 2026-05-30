import { NextResponse } from "next/server";
import { geminiJSON } from "@/lib/gemini";
import { HAND_SYSTEM_PROMPT } from "@/lib/constants";
import { mockHand, type HandInput } from "@/lib/mock-ai";
import type { ApiResponse, ProposalContent } from "@/types";

// POST /api/ai/hand — generate a sales proposal.
// Tries Claude (HAND prompt returns { proposal: ... }); on any
// failure or missing key, falls back to the deterministic mock.

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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

  const input: HandInput = {
    lead_name: str(body.lead_name),
    company: str(body.company),
    intent: str(body.intent),
    tone: str(body.tone) || "Professionale",
    bundle_ayrohub: Boolean(body.bundle_ayrohub),
    bundle_ayrodesk24: Boolean(body.bundle_ayrodesk24),
    bundle_ayromedia: Boolean(body.bundle_ayromedia),
  };

  if (!input.company) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: company." },
      { status: 400 },
    );
  }

  const ai = await geminiJSON<{ proposal: ProposalContent }>(
    HAND_SYSTEM_PROMPT,
    JSON.stringify(input),
    { complex: true, maxOutputTokens: 4096 },
  );
  const data = ai?.proposal ?? mockHand(input);

  return NextResponse.json<ApiResponse<ProposalContent>>({
    success: true,
    data,
  });
}
