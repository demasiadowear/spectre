import { NextResponse } from "next/server";
import {
  classifyVisorLeads,
  importFromVisor,
  type VisorImportResult,
} from "@/lib/autopilot/import";
import type { ApiResponse } from "@/types";

// Import manuale Visor -> Autopilot, dalla dashboard (protetta dal
// middleware sessione come le altre rotte /api/autopilot/*).
// GET = conteggio eleggibili (preview) + motivi di scarto, POST = import.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { eligible, skipped_fisso, skipped_duplicate, skipped_callback } =
      await classifyVisorLeads();
    return NextResponse.json<
      ApiResponse<{
        eligible: number;
        sample: string[];
        skipped_fisso: number;
        skipped_duplicate: number;
        skipped_callback: number;
      }>
    >({
      success: true,
      data: {
        eligible: eligible.length,
        sample: eligible.slice(0, 5).map((l) => l.company || l.name),
        skipped_fisso,
        skipped_duplicate,
        skipped_callback,
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
