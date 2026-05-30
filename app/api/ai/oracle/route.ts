import { NextResponse } from "next/server";
import { geminiJSON } from "@/lib/gemini";
import { ORACLE_SYSTEM_PROMPT } from "@/lib/constants";
import { mockOracle, type OracleInput } from "@/lib/mock-ai";
import type { ApiResponse, LeadStatus, OraclePrediction } from "@/types";

// POST /api/ai/oracle — predict close probability + 3 scenarios.
// Claude first, deterministic mock fallback otherwise.

const STATUSES: LeadStatus[] = [
  "todo",
  "step1_sent",
  "replied",
  "step2_sent",
  "preview_sent",
  "negotiating",
  "closed",
  "lost",
];

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
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

  const status = STATUSES.includes(body.status as LeadStatus)
    ? (body.status as LeadStatus)
    : "replied";

  const input: OracleInput = {
    lead_id: str(body.lead_id),
    lead_name: str(body.lead_name),
    company: str(body.company),
    value: num(body.value, 0),
    status,
    proposed_price: num(body.proposed_price, 0),
    days_to_followup: num(body.days_to_followup, 7),
    bundle_ayrohub: Boolean(body.bundle_ayrohub),
    bundle_ayrodesk24: Boolean(body.bundle_ayrodesk24),
    bundle_ayromedia: Boolean(body.bundle_ayromedia),
  };

  const ai = await geminiJSON<OraclePrediction>(
    ORACLE_SYSTEM_PROMPT,
    JSON.stringify(input),
    { temperature: 0.2 },
  );
  const data = ai ?? mockOracle(input);

  return NextResponse.json<ApiResponse<OraclePrediction>>({
    success: true,
    data,
  });
}
