import { NextResponse } from "next/server";
import { addSale, deleteSaleRow, editSaleRow, type SaleLine } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneClientDetail } from "@/types/zone";

// POST /api/zone/sales — registra una vendita multi-riga (prodotto ×
// quantità × prezzo manuale, con flag omaggio) e le card assegnate;
// il cliente passa a "venduto". Ogni riga scarica la giacenza. JWT.
export const dynamic = "force-dynamic";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : NaN;

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
  if (!clientId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: client_id." },
      { status: 400 },
    );
  }

  // Normalizza le righe. Retrocompat: se arriva il vecchio formato a
  // singolo prodotto (product_name/qty/price), lo avvolge in una riga.
  const rawLines = Array.isArray(body.lines)
    ? (body.lines as Record<string, unknown>[])
    : [{ product_id: body.product_id, product_name: body.product_name, qty: body.qty, price: body.price, omaggio: body.omaggio }];

  const lines: SaleLine[] = [];
  for (const l of rawLines) {
    const name = str(l.product_name).trim();
    if (!name) continue;
    const qty = num(l.qty);
    const omaggio = l.omaggio === true;
    const price = omaggio ? 0 : num(l.price);
    if (!Number.isFinite(qty) || qty < 1) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: `Quantità non valida per "${name}".` },
        { status: 400 },
      );
    }
    if (!omaggio && (!Number.isFinite(price) || price < 0)) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: `Prezzo non valido per "${name}".` },
        { status: 400 },
      );
    }
    lines.push({ product_id: str(l.product_id), product_name: name, qty, price, omaggio });
  }
  if (lines.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "La vendita deve avere almeno una riga (prodotto + quantità)." },
      { status: 400 },
    );
  }

  try {
    const detail = await addSale({
      client_id: clientId,
      lines,
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

// PATCH /api/zone/sales — corregge una riga vendita (prezzo/qty/
// omaggio). Body: { id, price?, qty?, omaggio? }.
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
  const id = str(body.id).trim();
  if (!id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: id (riga vendita)." },
      { status: 400 },
    );
  }
  const omaggio = body.omaggio === true ? true : body.omaggio === false ? false : undefined;
  const price =
    typeof body.price === "number" && Number.isFinite(body.price) && body.price >= 0
      ? body.price
      : undefined;
  const qty =
    typeof body.qty === "number" && Number.isFinite(body.qty) && body.qty >= 1
      ? Math.round(body.qty)
      : undefined;
  if (price === undefined && qty === undefined && omaggio === undefined) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Niente da modificare (price/qty/omaggio)." },
      { status: 400 },
    );
  }
  try {
    const detail = await editSaleRow(id, { price, qty, omaggio });
    if (!detail) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Riga vendita non trovata." },
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

// DELETE /api/zone/sales?id=<rowId> — annulla una riga vendita
// (i pezzi rientrano in giacenza).
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Parametro obbligatorio: id." },
      { status: 400 },
    );
  }
  try {
    const detail = await deleteSaleRow(id);
    if (!detail) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Riga vendita non trovata." },
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
