import { NextResponse } from "next/server";
import { addSale } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneClientDetail } from "@/types/zone";

// POST /api/zone/sales — registra una vendita (e le card assegnate);
// il cliente passa a "venduto". Dietro JWT.
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
  const productName = str(body.product_name).trim();
  const price = typeof body.price === "number" && Number.isFinite(body.price) ? body.price : null;
  if (!clientId || !productName || price === null || price < 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi obbligatori: client_id, product_name, price (≥ 0)." },
      { status: 400 },
    );
  }
  try {
    const detail = await addSale({
      client_id: clientId,
      product_id: str(body.product_id),
      product_name: productName,
      qty: typeof body.qty === "number" ? body.qty : 1,
      price,
      sold_at: str(body.sold_at) || undefined,
      notes: str(body.notes),
      card_codes: Array.isArray(body.card_codes)
        ? body.card_codes.filter((c): c is string => typeof c === "string")
        : [],
    });
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
