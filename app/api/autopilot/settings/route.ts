import { NextResponse } from "next/server";
import { addAlert, getSettings, setSetting } from "@/lib/autopilot/db";
import type { ApiResponse } from "@/types";
import type { AutopilotSettings } from "@/types/autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json<ApiResponse<AutopilotSettings>>({
      success: true,
      data: settings,
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

// Kill switch manuale globale + tuning cap giornalieri.
export async function PATCH(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Body JSON non valido." },
      { status: 400 },
    );
  }

  try {
    if (typeof body.kill_switch === "boolean") {
      await setSetting("kill_switch", body.kill_switch ? "1" : "0");
      await addAlert(
        "info",
        body.kill_switch
          ? "KILL SWITCH ATTIVATO manualmente: outreach e bot fermi."
          : "Kill switch disattivato: pipeline riattivata.",
      );
    }
    if (Number.isFinite(body.warmup_daily_cap)) {
      await setSetting("warmup_daily_cap", String(Number(body.warmup_daily_cap)));
    }
    if (Number.isFinite(body.steady_daily_cap)) {
      await setSetting("steady_daily_cap", String(Number(body.steady_daily_cap)));
    }
    const settings = await getSettings();
    return NextResponse.json<ApiResponse<AutopilotSettings>>({
      success: true,
      data: settings,
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
