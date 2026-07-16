import { NextResponse } from "next/server";
import { endLoan, startLoan } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneClientDetail } from "@/types/zone";

// POST /api/zone/loan — ciclo comodato (dietro JWT).
// { client_id, action:'start', product_id, card_codes?[] }
// { client_id, action:'ritirato' | 'convertito' }
export const dynamic = "force-dynamic";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

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
  const clientId = str(body.client_id).trim();
  const action = str(body.action);
  if (!clientId || !["start", "ritirato", "convertito"].includes(action)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi obbligatori: client_id, action (start|ritirato|convertito)." },
      { status: 400 },
    );
  }
  try {
    let detail: ZoneClientDetail | null;
    if (action === "start") {
      const productId = str(body.product_id).trim();
      if (!productId) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Scegli il prodotto lasciato in comodato (product_id)." },
          { status: 400 },
        );
      }
      detail = await startLoan(
        clientId,
        productId,
        Array.isArray(body.card_codes)
          ? body.card_codes.filter((c): c is string => typeof c === "string")
          : [],
      );
    } else {
      detail = await endLoan(clientId, action as "ritirato" | "convertito");
    }
    if (!detail) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Cliente non trovato nel registro." },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiResponse<ZoneClientDetail>>({ success: true, data: detail });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
