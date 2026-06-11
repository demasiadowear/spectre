import { NextResponse } from "next/server";
import { getCases } from "@/lib/detective/db";
import {
  investigateAndAnalyze,
  type InvestigateOutcome,
} from "@/lib/detective/run";
import type { ApiResponse } from "@/types";

// POST /api/detective/investigate — indagine singola o batch.
// body: { case_id: "det-…" } oppure { case_ids: [...] } oppure
// { all_scouted: true, limit?: n } per il batch dalla dashboard.
// Auth: middleware JWT esistente. Sequenziale: un'indagine alla
// volta (rispetto di Places/Gemini e dei siti target).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  let ids: string[] = [];
  if (typeof body.case_id === "string") ids = [body.case_id];
  else if (Array.isArray(body.case_ids)) {
    ids = (body.case_ids as unknown[]).filter(
      (v): v is string => typeof v === "string",
    );
  } else if (body.all_scouted === true) {
    const limit = Number.isFinite(body.limit) ? Number(body.limit) : 5;
    ids = (await getCases("scouted")).slice(0, limit).map((c) => c.id);
  }

  if (ids.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error: "Serve case_id, case_ids[] o all_scouted=true.",
      },
      { status: 400 },
    );
  }

  const outcomes: InvestigateOutcome[] = [];
  for (const id of ids.slice(0, 10)) {
    outcomes.push(await investigateAndAnalyze(id));
  }

  return NextResponse.json<ApiResponse<InvestigateOutcome[]>>({
    success: true,
    data: outcomes,
    meta: { total: outcomes.length, page: 1, limit: outcomes.length },
  });
}
