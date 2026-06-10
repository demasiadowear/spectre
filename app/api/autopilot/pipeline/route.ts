import { NextResponse } from "next/server";
import {
  archiveLead,
  getPipeline,
  getStats,
  getWaMessages,
} from "@/lib/autopilot/db";
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

/** Azioni rapide sulla pipeline (per ora: archivia). */
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

  const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!leadId || action !== "archive") {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Servono lead_id e action=archive." },
      { status: 400 },
    );
  }

  try {
    await archiveLead(leadId);
    return NextResponse.json<ApiResponse<{ lead_id: string }>>({
      success: true,
      data: { lead_id: leadId },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
