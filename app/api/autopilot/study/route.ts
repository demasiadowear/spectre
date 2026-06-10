import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";
import { runStudy, type StudyResult } from "@/lib/autopilot/study";
import type { ApiResponse } from "@/types";

// Stadio 1.5 — STUDY. Cron Vercel: enrichment + brief + primo
// messaggio WA per i lead in stato "nuovo".
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Non autorizzato." },
      { status: 401 },
    );
  }
  try {
    const result = await runStudy();
    console.log("[autopilot/study]", JSON.stringify(result));
    return NextResponse.json<ApiResponse<StudyResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
