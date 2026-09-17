import { NextResponse } from "next/server";
import { cancelJob, cancelLeadJobs, listJobs, queueCounts } from "@/lib/factory/queue";
import { enrollLead } from "@/lib/factory/orchestrator";
import type { ApiResponse } from "@/types";
import type { AgentJob, JobStatus } from "@/types/factory";

// ============================================================
// Coda agentica vista dalla dashboard. Dietro la sessione (middleware).
//  GET    = stato della coda
//  POST   = mette un lead in lavorazione
//  DELETE = annulla un job, oppure tutta la coda di un lead (freno)
// ============================================================

export const dynamic = "force-dynamic";

const VALID_STATUS: JobStatus[] = [
  "pending",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawStatus = url.searchParams.get("status");
    const status = VALID_STATUS.includes(rawStatus as JobStatus)
      ? (rawStatus as JobStatus)
      : undefined;
    const leadId = url.searchParams.get("lead_id") ?? undefined;
    const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 100), 500);

    const [jobs, counts] = await Promise.all([
      listJobs({ status, leadId, limit }),
      queueCounts(),
    ]);
    return NextResponse.json<
      ApiResponse<{ jobs: AgentJob[]; counts: Record<JobStatus, number> }>
    >({
      success: true,
      data: { jobs, counts },
      meta: { total: jobs.length, page: 1, limit },
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
    if (!leadId) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "lead_id obbligatorio" },
        { status: 400 },
      );
    }
    const reason =
      typeof raw.reason === "string" && raw.reason.trim()
        ? raw.reason.trim().slice(0, 300)
        : "lead messo in lavorazione dalla dashboard";

    const res = await enrollLead(leadId, reason);
    return NextResponse.json<ApiResponse<typeof res>>({ success: true, data: res });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const leadId = url.searchParams.get("lead_id");

    if (id) {
      const cancelled = await cancelJob(id, "annullato dalla dashboard");
      return NextResponse.json<ApiResponse<{ cancelled: boolean }>>({
        success: true,
        data: { cancelled },
      });
    }
    if (leadId) {
      const count = await cancelLeadJobs(leadId, "lead fermato dalla dashboard");
      return NextResponse.json<ApiResponse<{ cancelled: number }>>({
        success: true,
        data: { cancelled: count },
      });
    }
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "serve id oppure lead_id" },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
