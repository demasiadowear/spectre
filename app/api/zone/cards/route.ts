import { NextResponse } from "next/server";
import { assignCard, findClientByCardCode, replaceCard } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneCard, ZoneClient } from "@/types/zone";

// /api/zone/cards — registro card fisiche (dietro JWT).
// GET  ?code=XYZ                          ricerca inversa codice -> cliente
// POST { code, client_id, notes? }        assegna card
// PATCH { old_code, new_code, notes? }    sostituzione (storia conservata)
export const dynamic = "force-dynamic";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Parametro obbligatorio: code." },
      { status: 400 },
    );
  }
  try {
    const found = await findClientByCardCode(code);
    if (!found) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: `Nessuna card col codice "${code}" nel registro.` },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiResponse<{ card: ZoneCard; client: ZoneClient }>>({
      success: true,
      data: found,
    });
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
  const code = str(body.code).trim();
  const clientId = str(body.client_id).trim();
  if (!code || !clientId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi obbligatori: code, client_id." },
      { status: 400 },
    );
  }
  try {
    await assignCard(code, clientId, str(body.sale_id), str(body.notes));
    return NextResponse.json<ApiResponse<{ code: string }>>({
      success: true,
      data: { code },
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
  const oldCode = str(body.old_code).trim();
  const newCode = str(body.new_code).trim();
  if (!oldCode || !newCode) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi obbligatori: old_code, new_code." },
      { status: 400 },
    );
  }
  try {
    const card = await replaceCard(oldCode, newCode, str(body.notes));
    if (!card) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: `Card "${oldCode}" non trovata nel registro.` },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiResponse<ZoneCard>>({ success: true, data: card });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
