import { NextResponse } from "next/server";
import {
  DETECTIVE_STATUSES,
  getCases,
  updateCase,
} from "@/lib/detective/db";
import type { ApiResponse } from "@/types";
import type { DetectiveCase, DetectiveStatus } from "@/types/detective";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const statusParam = new URL(req.url).searchParams.get("status");
  const status = DETECTIVE_STATUSES.includes(statusParam as DetectiveStatus)
    ? (statusParam as DetectiveStatus)
    : undefined;
  try {
    const cases = await getCases(status);
    return NextResponse.json<ApiResponse<DetectiveCase[]>>({
      success: true,
      data: cases,
      meta: { total: cases.length, page: 1, limit: cases.length },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/** Avanzamento manuale di stato nel funnel dedicato (sent/interested/pilot/archived). */
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

  const id = typeof body.case_id === "string" ? body.case_id : "";
  const status = body.status as DetectiveStatus;
  if (!id || !DETECTIVE_STATUSES.includes(status)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Servono case_id e status valido." },
      { status: 400 },
    );
  }

  try {
    await updateCase(id, { status });
    return NextResponse.json<ApiResponse<{ case_id: string; status: string }>>({
      success: true,
      data: { case_id: id, status },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
