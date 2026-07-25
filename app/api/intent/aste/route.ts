import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";
import { runAsteScout } from "@/lib/intent/aste";
import type { ApiResponse } from "@/types";
import type { AsteScoutResult } from "@/types/intent";

// ASTE SCOUT — sorgente Scout aggiuntiva: aste giudiziarie
// (immobili residenziali, Tribunale di Bari) su astegiudiziarie.it.
// Digest Telegram giornaliero. Invocato una volta al giorno dallo
// scheduler esterno (cron-job.org o Vercel Cron su Pro) con header
// `Authorization: Bearer ${CRON_SECRET}`, come gli altri scout. GET.
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
    const result = await runAsteScout();
    console.log("[aste/scout]", JSON.stringify(result));
    return NextResponse.json<ApiResponse<AsteScoutResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("[aste/scout] run fallita:", err);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
