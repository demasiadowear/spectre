import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";
import { runScout, type ScoutResult } from "@/lib/autopilot/scout";
import type { ApiResponse } from "@/types";

// Stadio 1 — SCOUT. Invocato dal cron Vercel (vercel.json) una volta
// al giorno; GET perché Vercel Cron fa GET.
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
    const result = await runScout();
    console.log("[autopilot/scout]", JSON.stringify(result));
    return NextResponse.json<ApiResponse<ScoutResult>>({
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
