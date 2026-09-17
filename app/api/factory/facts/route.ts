import { NextResponse } from "next/server";
import { decideFact, logActivity } from "@/lib/factory/db";
import { guardiaRichiesta } from "@/lib/guardia-richiesta";
import type { ApiResponse } from "@/types";

// ============================================================
// Approvazione / scarto dei fatti proposti dall'automazione.
//
// È il punto in cui una persona decide se un dato trovato da una
// macchina può essere usato come vero. Per questo la decisione finisce
// in timeline: fra sei mesi si deve poter risalire a chi ha detto sì a
// un numero di telefono, e quando.
// ============================================================

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  try {
    const g = guardiaRichiesta(req, { metodi: ["PATCH"] });
    if (!g.ok) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: g.error }, { status: g.status },
      );
    }
    const body: unknown = await req.json().catch(() => ({}));
    const raw = (body ?? {}) as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const decision = raw.decision === "applied" || raw.decision === "dismissed" ? raw.decision : "";
    const leadId = typeof raw.lead_id === "string" ? raw.lead_id.trim() : "";

    if (!id || !decision) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "serve id e decision (applied|dismissed)" },
        { status: 400 },
      );
    }

    await decideFact(id, decision);
    if (leadId) {
      await logActivity({
        lead_id: leadId,
        type: "note",
        subject: decision === "applied" ? "Fatto approvato" : "Fatto scartato",
        body: `Decisione manuale sul fatto ${id}.`,
        metadata: { fact_id: id, decision },
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
