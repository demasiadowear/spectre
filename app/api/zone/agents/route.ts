import { NextResponse } from "next/server";
import { listAgents, setAgentActive, upsertAgent } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneAgent } from "@/types/zone";

// /api/zone/agents — anagrafica agenti/segnalatori (dietro JWT).
// GET ?all=1 include i disattivati · POST upsert · DELETE ?id= disattiva
// (soft: lo storico resta, sparisce dai select delle nuove vendite).
export const dynamic = "force-dynamic";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function GET(req: Request) {
  try {
    const all = new URL(req.url).searchParams.get("all") === "1";
    const agents = await listAgents(all);
    return NextResponse.json<ApiResponse<ZoneAgent[]>>({ success: true, data: agents });
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
  const nome = str(body.nome).trim();
  if (!nome) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: nome." },
      { status: 400 },
    );
  }
  try {
    const agents = await upsertAgent({
      id: str(body.id) || undefined,
      nome,
      telefono: str(body.telefono),
      commission_pct:
        typeof body.commission_pct === "number" && Number.isFinite(body.commission_pct)
          ? body.commission_pct
          : undefined,
      attivo: body.attivo === false ? false : true,
      note: str(body.note),
    });
    return NextResponse.json<ApiResponse<ZoneAgent[]>>({ success: true, data: agents });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Parametro obbligatorio: id." },
      { status: 400 },
    );
  }
  try {
    const agents = await setAgentActive(id, false);
    return NextResponse.json<ApiResponse<ZoneAgent[]>>({ success: true, data: agents });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
