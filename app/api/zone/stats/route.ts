import { NextResponse } from "next/server";
import { zoneStats } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneStats } from "@/types/zone";

// GET /api/zone/stats — analisi dal registro (dietro JWT):
// fatturato, conversione, zone che rendono, da richiamare.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await zoneStats();
    return NextResponse.json<ApiResponse<ZoneStats>>({ success: true, data: stats });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
