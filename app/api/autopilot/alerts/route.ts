import { NextResponse } from "next/server";
import { getAlerts, markAlertsRead } from "@/lib/autopilot/db";
import type { ApiResponse } from "@/types";
import type { AutopilotAlert } from "@/types/autopilot";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  try {
    const alerts = await getAlerts(unreadOnly);
    return NextResponse.json<ApiResponse<AutopilotAlert[]>>({
      success: true,
      data: alerts,
      meta: { total: alerts.length, page: 1, limit: alerts.length },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/** Segna tutte le notifiche come lette. */
export async function PATCH() {
  try {
    await markAlertsRead();
    return NextResponse.json<ApiResponse<{ ok: true }>>({
      success: true,
      data: { ok: true },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
