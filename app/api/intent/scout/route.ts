import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";
import { runIntentScout } from "@/lib/intent/scout";
import type { ApiResponse } from "@/types";
import type { IntentScoutResult } from "@/types/intent";

// INTENT SCOUT. Invocato ogni 2 ore (7-21) da uno scheduler esterno
// (cron-job.org o Vercel Cron se piano Pro) con header
// `Authorization: Bearer ${CRON_SECRET}` — stesso guard degli altri
// scout. GET perché gli scheduler fanno GET.
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
    const result = await runIntentScout();
    console.log("[intent/scout]", JSON.stringify(result));
    return NextResponse.json<ApiResponse<IntentScoutResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    // Log server-side: la response la legge solo lo scheduler esterno,
    // i log Vercel sono l'unica traccia consultabile a posteriori.
    console.error("[intent/scout] run fallita:", err);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
