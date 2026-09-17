import { NextResponse } from "next/server";
import { completeFollowup, listFollowups, scheduleFollowup } from "@/lib/factory/db";
import type { ApiResponse } from "@/types";
import type { Followup } from "@/types/factory";

// ============================================================
// Promemoria. Il sistema RICORDA, non manda: non esiste un percorso in
// cui creare un follow-up faccia partire un messaggio. Chi vuole
// mandare qualcosa apre la scheda e lo manda a mano, come sempre.
// ============================================================

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const onlyOpen = url.searchParams.get("open") === "1";
    const leadId = url.searchParams.get("lead_id") ?? undefined;
    const items = await listFollowups({ leadId, onlyOpen });
    return NextResponse.json<ApiResponse<Followup[]>>({
      success: true,
      data: items,
      meta: { total: items.length, page: 1, limit: items.length },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const raw = (body ?? {}) as Record<string, unknown>;
    const leadId = typeof raw.lead_id === "string" ? raw.lead_id.trim() : "";
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 200) : "";
    const dueAtRaw = typeof raw.due_at === "string" ? raw.due_at : "";

    if (!leadId || !title || !dueAtRaw) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "serve lead_id, title e due_at" },
        { status: 400 },
      );
    }
    const due = new Date(dueAtRaw);
    if (Number.isNaN(due.getTime())) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "due_at non è una data valida" },
        { status: 400 },
      );
    }

    const res = await scheduleFollowup({
      lead_id: leadId,
      title,
      due_at: due.toISOString(),
      note: typeof raw.note === "string" ? raw.note.slice(0, 2000) : "",
    });
    return NextResponse.json<ApiResponse<typeof res>>({ success: true, data: res });
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
    const id = typeof (body as { id?: unknown })?.id === "string" ? (body as { id: string }).id : "";
    if (!id) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "id obbligatorio" },
        { status: 400 },
      );
    }
    await completeFollowup(id);
    return NextResponse.json<ApiResponse<{ ok: true }>>({ success: true, data: { ok: true } });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
