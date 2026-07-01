import { NextResponse } from "next/server";
import { runAuditScout, type AuditScoutResult } from "@/lib/detective/scout";
import { parseOptionalNumber } from "@/lib/utils";
import type { ApiResponse } from "@/types";

// Scout mode "audit" — trigger MANUALE dalla dashboard (no cron in v1).
// Auth: middleware JWT (nessun bypass cron su questo path).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* body vuoto = default */
  }

  try {
    const result = await runAuditScout({
      categories: Array.isArray(body.categories)
        ? (body.categories as string[])
        : undefined,
      locations: Array.isArray(body.locations)
        ? (body.locations as string[])
        : undefined,
      limit: parseOptionalNumber(body.limit),
    });
    console.log("[detective/scout]", JSON.stringify(result));
    return NextResponse.json<ApiResponse<AuditScoutResult>>({
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
