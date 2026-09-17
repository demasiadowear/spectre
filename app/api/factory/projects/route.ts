import { NextResponse } from "next/server";
import { listProjects, setProjectStage } from "@/lib/factory/db";
import { logActivity } from "@/lib/factory/db";
import type { ApiResponse } from "@/types";
import type { FactoryStage, ForgeProject } from "@/types/factory";

// ============================================================
// Progetti sito per la dashboard. La PATCH serve a due passaggi che
// restano manuali per scelta:
//  - `sent`: l'operatore dichiara di aver mandato il link (la Factory
//    non lo manda, quindi non può saperlo da sola);
//  - `client_approved`: il cliente ha detto sì e la bozza diventa un
//    lavoro vero.
// ============================================================

export const dynamic = "force-dynamic";

/** Fasi impostabili a mano. Le fasi tecniche (generating, qa_pending…)
 *  le muove solo il worker: consentirle qui creerebbe stati incoerenti. */
const MANUAL_STAGES: FactoryStage[] = [
  "sent",
  "viewed",
  "replied",
  "appointment",
  "negotiating",
  "won",
  "lost",
  "client_approved",
  "rejected",
];

export async function GET(req: Request) {
  try {
    const limit = Math.min(
      Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 200),
      500,
    );
    const projects = await listProjects(limit);
    return NextResponse.json<ApiResponse<ForgeProject[]>>({
      success: true,
      data: projects,
      meta: { total: projects.length, page: 1, limit },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const raw = (body ?? {}) as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const stage = MANUAL_STAGES.includes(raw.stage as FactoryStage)
      ? (raw.stage as FactoryStage)
      : null;
    const leadId = typeof raw.lead_id === "string" ? raw.lead_id.trim() : "";

    if (!id || !stage) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: `serve id e una fase fra: ${MANUAL_STAGES.join(", ")}` },
        { status: 400 },
      );
    }

    await setProjectStage(id, stage);
    if (leadId) {
      await logActivity({
        lead_id: leadId,
        forge_project_id: id,
        type: "stage_change",
        subject: `Fase impostata a mano: ${stage}`,
        created_by: "puccio",
      });
    }
    return NextResponse.json<ApiResponse<{ ok: true }>>({ success: true, data: { ok: true } });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
