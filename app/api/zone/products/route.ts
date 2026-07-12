import { NextResponse } from "next/server";
import { listProducts, upsertProduct } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneProduct } from "@/types/zone";

// /api/zone/products — listino configurabile (dietro JWT).
// GET ?all=1 include i ritirati · POST { id?, name, default_price, active? }
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const all = new URL(req.url).searchParams.get("all") === "1";
    const products = await listProducts(all);
    return NextResponse.json<ApiResponse<ZoneProduct[]>>({
      success: true,
      data: products,
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
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const price =
    typeof body.default_price === "number" && Number.isFinite(body.default_price)
      ? body.default_price
      : null;
  if (!name || price === null || price < 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi obbligatori: name, default_price (≥ 0)." },
      { status: 400 },
    );
  }
  try {
    await upsertProduct({
      id: typeof body.id === "string" ? body.id : undefined,
      name,
      default_price: price,
      active: body.active !== false,
    });
    const products = await listProducts(true);
    return NextResponse.json<ApiResponse<ZoneProduct[]>>({
      success: true,
      data: products,
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
