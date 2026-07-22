import { NextResponse } from "next/server";
import { addStockMove, listProducts, updateProductStockMeta } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneProduct } from "@/types/zone";

// POST /api/zone/stock — carico ordine / rettifica giacenza (dietro
// JWT). { product_id, delta, motivo:'carico'|'rettifica', notes? }
// PATCH — soglia/fornitore: { product_id, stock_soglia?, fornitore? }
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
  const productId = str(body.product_id).trim();
  const delta = typeof body.delta === "number" ? Math.round(body.delta) : NaN;
  const motivo = str(body.motivo);
  if (!productId || !Number.isFinite(delta) || delta === 0 || !["carico", "rettifica"].includes(motivo)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi: product_id, delta (≠0), motivo (carico|rettifica)." },
      { status: 400 },
    );
  }
  try {
    await addStockMove(productId, delta, motivo as "carico" | "rettifica", "", str(body.notes));
    const products = await listProducts(true);
    return NextResponse.json<ApiResponse<ZoneProduct[]>>({ success: true, data: products });
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
  const productId = str(body.product_id).trim();
  if (!productId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: product_id." },
      { status: 400 },
    );
  }
  try {
    await updateProductStockMeta(productId, {
      stock_soglia:
        typeof body.stock_soglia === "number" ? Math.max(0, Math.round(body.stock_soglia)) : undefined,
      fornitore: typeof body.fornitore === "string" ? body.fornitore : undefined,
      unit_cost:
        typeof body.unit_cost === "number" && Number.isFinite(body.unit_cost) && body.unit_cost >= 0
          ? Math.round(body.unit_cost * 100) / 100
          : undefined,
    });
    const products = await listProducts(true);
    return NextResponse.json<ApiResponse<ZoneProduct[]>>({ success: true, data: products });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
