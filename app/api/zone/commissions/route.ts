import { NextResponse } from "next/server";
import { commissionReport, markCommissionPaid } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { CommissionReport } from "@/types/zone";

// /api/zone/commissions — provvigioni per periodo + agente (dietro JWT).
// GET ?start=YYYY-MM-DD&end=YYYY-MM-DD&agent=<id> (default: mese corrente,
//     tutti gli agenti). POST { agent_id, start, end, importo } = segna
// pagato. Un solo importo per agente: nessuno scorporo fiscale.
export const dynamic = "force-dynamic";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Primo e ultimo giorno del mese corrente (Europe/Rome) in ISO. */
function currentMonth(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const def = currentMonth();
  const start = isDate(sp.get("start") ?? "") ? (sp.get("start") as string) : def.start;
  const end = isDate(sp.get("end") ?? "") ? (sp.get("end") as string) : def.end;
  const agent = sp.get("agent")?.trim() || undefined;
  try {
    const report = await commissionReport(start, end, agent);
    return NextResponse.json<ApiResponse<CommissionReport>>({ success: true, data: report });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Body JSON non valido." },
      { status: 400 },
    );
  }
  const agent_id = str(body.agent_id).trim();
  const start = str(body.start);
  const end = str(body.end);
  const importo = typeof body.importo === "number" && Number.isFinite(body.importo) ? body.importo : NaN;
  if (!agent_id || !isDate(start) || !isDate(end) || !Number.isFinite(importo)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi: agent_id, start, end (YYYY-MM-DD), importo." },
      { status: 400 },
    );
  }
  try {
    await markCommissionPaid({ agent_id, periodo_start: start, periodo_end: end, importo });
    const report = await commissionReport(start, end, undefined);
    return NextResponse.json<ApiResponse<CommissionReport>>({ success: true, data: report });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
