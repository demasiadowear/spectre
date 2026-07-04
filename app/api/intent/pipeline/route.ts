import { NextResponse } from "next/server";
import {
  getIntentPipeline,
  getIntentStats,
  updateIntentStage,
} from "@/lib/intent/db";
import { INTENT_STAGES } from "@/lib/intent/constants";
import type { ApiResponse } from "@/types";
import type { IntentLead, IntentStage, IntentStats } from "@/types/intent";

// Kanban intent: lista + stats (GET), cambio colonna (PATCH).
// Protetta dal JWT di sessione via middleware, come le altre API.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [leads, stats] = await Promise.all([
      getIntentPipeline(),
      getIntentStats(),
    ]);
    return NextResponse.json<
      ApiResponse<{ leads: IntentLead[]; stats: IntentStats }>
    >({ success: true, data: { leads, stats } });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as { lead_id?: string; stage?: string };
    const leadId = body.lead_id?.trim();
    const stage = body.stage as IntentStage;
    if (!leadId || !INTENT_STAGES.includes(stage)) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "lead_id o stage non validi." },
        { status: 400 },
      );
    }
    const updated = await updateIntentStage(leadId, stage);
    if (!updated) {
      // Riga inesistente o DB non configurato: il client deve fare
      // rollback dell'update ottimistico, non credere al salvataggio.
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Lead non trovato o DB non configurato." },
        { status: 404 },
      );
    }
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
