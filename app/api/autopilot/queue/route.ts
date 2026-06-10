import { NextResponse } from "next/server";
import {
  approveMessage,
  getApprovalQueue,
  rejectMessage,
} from "@/lib/autopilot/db";
import type { ApiResponse } from "@/types";
import type { AutopilotLead } from "@/types/autopilot";

// Coda "da approvare": review manuale di Puccio dei primi messaggi WA
// (obbligatoria nei primi 14 giorni di warm-up).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const queue = await getApprovalQueue();
    return NextResponse.json<ApiResponse<AutopilotLead[]>>({
      success: true,
      data: queue,
      meta: { total: queue.length, page: 1, limit: queue.length },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

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
  if (!leadId || !["approve", "reject"].includes(action)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Servono lead_id e action (approve|reject)." },
      { status: 400 },
    );
  }

  try {
    if (action === "approve") {
      const edited =
        typeof body.message === "string" ? body.message : undefined;
      await approveMessage(leadId, edited);
    } else {
      await rejectMessage(leadId);
    }
    return NextResponse.json<ApiResponse<{ lead_id: string; action: string }>>({
      success: true,
      data: { lead_id: leadId, action },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
