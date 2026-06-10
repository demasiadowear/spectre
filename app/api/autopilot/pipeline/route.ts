import { NextResponse } from "next/server";
import { getPipeline, getStats, getWaMessages } from "@/lib/autopilot/db";
import type { ApiResponse } from "@/types";
import type {
  AutopilotLead,
  AutopilotStage,
  AutopilotStats,
  WaMessage,
} from "@/types/autopilot";
import { AUTOPILOT_STAGES } from "@/lib/autopilot/constants";

export const dynamic = "force-dynamic";

interface PipelinePayload {
  leads: AutopilotLead[];
  stats: AutopilotStats;
  /** Chat completa quando si chiede ?lead_id=… */
  messages?: WaMessage[];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const stageParam = url.searchParams.get("stage");
  const leadId = url.searchParams.get("lead_id");

  const stage = AUTOPILOT_STAGES.includes(stageParam as AutopilotStage)
    ? (stageParam as AutopilotStage)
    : undefined;

  try {
    const [leads, stats] = await Promise.all([getPipeline(stage), getStats()]);
    const payload: PipelinePayload = { leads, stats };
    if (leadId) payload.messages = await getWaMessages(leadId);
    return NextResponse.json<ApiResponse<PipelinePayload>>({
      success: true,
      data: payload,
      meta: { total: leads.length, page: 1, limit: leads.length },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
