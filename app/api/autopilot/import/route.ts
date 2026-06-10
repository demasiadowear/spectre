import { NextResponse } from "next/server";
import {
  eligibleVisorLeads,
  importFromVisor,
  type VisorImportResult,
} from "@/lib/autopilot/import";
import type { ApiResponse } from "@/types";

// Import manuale Visor -> Autopilot, dalla dashboard (protetta dal
// middleware sessione come le altre rotte /api/autopilot/*).
// GET = conteggio eleggibili (preview), POST = import in batch.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const eligible = await eligibleVisorLeads();
    return NextResponse.json<
      ApiResponse<{ eligible: number; sample: string[] }>
    >({
      success: true,
      data: {
        eligible: eligible.length,
        sample: eligible.slice(0, 5).map((l) => l.company || l.name),
      },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const result = await importFromVisor();
    return NextResponse.json<ApiResponse<VisorImportResult>>({
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
