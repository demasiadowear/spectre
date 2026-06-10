import { NextResponse } from "next/server";
import { addAlert, approveBuild, getBuilds } from "@/lib/autopilot/db";
import type { ApiResponse } from "@/types";
import type { AutopilotBuild } from "@/types/autopilot";

// Stadio 3 — task di build demo. La preview deployata resta "deployed"
// finché Puccio non la approva qui: solo dopo il worker la invia al cliente.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const builds = await getBuilds();
    return NextResponse.json<ApiResponse<AutopilotBuild[]>>({
      success: true,
      data: builds,
      meta: { total: builds.length, page: 1, limit: builds.length },
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

  const buildId = typeof body.build_id === "string" ? body.build_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!buildId || action !== "approve") {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Servono build_id e action=approve." },
      { status: 400 },
    );
  }

  try {
    await approveBuild(buildId);
    await addAlert("info", `Demo ${buildId} approvata: invio al cliente in coda.`);
    return NextResponse.json<ApiResponse<{ build_id: string }>>({
      success: true,
      data: { build_id: buildId },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
