import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";
import { runStudy, type StudyResult } from "@/lib/autopilot/study";
import { parseOptionalNumber } from "@/lib/utils";
import type { ApiResponse } from "@/types";

// Stadio 1.5 — STUDY. Cron Vercel: enrichment + brief + primo
// messaggio WA per i lead "da contattare" ancora senza messaggio.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Lotto di default (cron Vercel giornaliero e "Studia ora"). */
const DEFAULT_LIMIT = 30;
const LIMIT_MIN = 1;
const LIMIT_MAX = 50;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Non autorizzato." },
      { status: 401 },
    );
  }
  // ?limit=N: i cron esterni (cron-job.org, timeout client 30s) chiamano
  // lotti piccoli e frequenti che chiudono la risposta entro il timeout;
  // il cron Vercel giornaliero resta sul default pieno.
  const limit = parseOptionalNumber(
    new URL(req.url).searchParams.get("limit"),
  );
  return runAndRespond(
    limit == null
      ? DEFAULT_LIMIT
      : Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(limit))),
  );
}

/** Run on-demand dal pulsante "Studia ora" della dashboard. Nessun
 *  check cron qui: le richieste browser arrivano solo con sessione
 *  JWT valida (il middleware bypassa il login soltanto per i cron
 *  col Bearer CRON_SECRET). */
export async function POST() {
  return runAndRespond(DEFAULT_LIMIT);
}

async function runAndRespond(limit: number) {
  try {
    const result = await runStudy(limit);
    console.log("[autopilot/study]", JSON.stringify({ limit, ...result }));
    return NextResponse.json<ApiResponse<StudyResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
