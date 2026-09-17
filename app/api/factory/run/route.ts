import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";
import { DEFAULT_BATCH, MAX_BATCH, runWorker, type WorkerResult } from "@/lib/factory/orchestrator";
import type { ApiResponse } from "@/types";
import type { JobKind } from "@/types/factory";

// ============================================================
// Worker della Factory. Due modi di autenticarsi, nessun terzo:
//  - cron/worker: Authorization: Bearer ${CRON_SECRET};
//  - operatore dalla dashboard: sessione NextAuth.
// Senza uno dei due si risponde 401 senza toccare la coda.
//
// GET  = giro del cron (batch di default, nessuno screenshot).
// POST = avvio manuale, con batch, tipi e dry-run scelti dall'operatore.
//
// Il worker è protetto anche in orario: il middleware copre già le API,
// ma il controllo è ripetuto qui perché questa route spende soldi e non
// deve dipendere da una sola riga di configurazione.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID_KINDS: JobKind[] = [
  "analyze_website",
  "research_business",
  "generate_site",
  "run_site_qa",
  "prepare_outreach",
  "schedule_followup",
];

async function authorize(req: Request): Promise<boolean> {
  if (isCronAuthorized(req)) return true;
  const session = await getServerSession(authOptions).catch(() => null);
  return Boolean(session);
}

const unauthorized = () =>
  NextResponse.json<ApiResponse<never>>(
    { success: false, error: "non autorizzato" },
    { status: 401 },
  );

export async function GET(req: Request) {
  if (!(await authorize(req))) return unauthorized();
  try {
    const result = await runWorker({ batch: DEFAULT_BATCH });
    return NextResponse.json<ApiResponse<WorkerResult>>({ success: true, data: result });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!(await authorize(req))) return unauthorized();
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const raw = (body ?? {}) as Record<string, unknown>;

    // Batch clampato lato server: un client non può chiedere 5000 job.
    const batch = Math.min(
      Math.max(1, Number(raw.batch) || DEFAULT_BATCH),
      MAX_BATCH,
    );
    // Solo i tipi noti: nessuna stringa arbitraria raggiunge la query.
    const kinds = Array.isArray(raw.kinds)
      ? (raw.kinds.filter((k): k is JobKind => VALID_KINDS.includes(k as JobKind)))
      : undefined;
    const dryRun = raw.dry_run === true;

    const result = await runWorker({ batch, kinds, dryRun });
    return NextResponse.json<ApiResponse<WorkerResult>>({ success: true, data: result });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
