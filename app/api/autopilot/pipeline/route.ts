import { NextResponse } from "next/server";
import {
  approveDemoUrl,
  archiveLead,
  getPipeline,
  getStats,
  getWaMessages,
  markDemoRequested,
  updateDeal,
} from "@/lib/autopilot/db";
import { DEAL_STAGES } from "@/types/autopilot";
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

/** Azioni rapide sulla pipeline: archivia, segna demo richiesta,
 *  approva il link demo (incollato a mano da Puccio: SPECTRE non
 *  builda nulla, il worker invia solo dietro questa approvazione). */
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
  if (!leadId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Serve lead_id." },
      { status: 400 },
    );
  }

  try {
    if (action === "archive") {
      await archiveLead(leadId);
    } else if (action === "demo_requested") {
      await markDemoRequested(leadId);
    } else if (action === "update_deal") {
      // Stati trattativa: SOLO manuali, mai automatismi verso il lead.
      const stage =
        typeof body.stage === "string" &&
        DEAL_STAGES.includes(body.stage as (typeof DEAL_STAGES)[number])
          ? (body.stage as (typeof DEAL_STAGES)[number])
          : undefined;
      if (typeof body.stage === "string" && !stage) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: `Stage trattativa non valido: ${body.stage}` },
          { status: 400 },
        );
      }
      await updateDeal(leadId, {
        stage,
        next_action:
          typeof body.next_action === "string" ? body.next_action : undefined,
        next_action_at:
          typeof body.next_action_at === "string"
            ? body.next_action_at || null
            : undefined,
        lost_reason:
          typeof body.lost_reason === "string" ? body.lost_reason : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
    } else if (action === "approve_demo_url") {
      const demoUrl = typeof body.demo_url === "string" ? body.demo_url.trim() : "";
      if (!/^https?:\/\/\S+$/.test(demoUrl)) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "demo_url non valido: serve un link http(s)." },
          { status: 400 },
        );
      }
      await approveDemoUrl(leadId, demoUrl);
    } else {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error:
            "action deve essere archive | demo_requested | update_deal | approve_demo_url.",
        },
        { status: 400 },
      );
    }
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
