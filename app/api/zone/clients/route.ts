import { NextResponse } from "next/server";
import {
  ZONE_STATUSES,
  getClientDetail,
  listClients,
  setBaselineNow,
  updateClient,
  upsertClient,
  type UpsertClientInput,
} from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneClient, ZoneClientDetail, ZoneClientStatus } from "@/types/zone";

// /api/zone/clients — registro clienti card NFC (dietro JWT).
// GET  ?id=<place_id>            scheda completa (vendite+card)
// GET  ?status=&cap=&zone=&q=    lista filtrata
// POST { ...cliente }            upsert (da scan o inserimento manuale)
// PATCH { id, ...campi }         stato / note / referente / richiamo / giro
export const dynamic = "force-dynamic";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function isStatus(v: unknown): v is ZoneClientStatus {
  return typeof v === "string" && (ZONE_STATUSES as string[]).includes(v);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const id = url.searchParams.get("id");
    if (id) {
      const detail = await getClientDetail(id);
      if (!detail) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Cliente non trovato nel registro." },
          { status: 404 },
        );
      }
      return NextResponse.json<ApiResponse<ZoneClientDetail>>({
        success: true,
        data: detail,
      });
    }
    const status = url.searchParams.get("status");
    const invoice = url.searchParams.get("invoice");
    const clients = await listClients({
      status: isStatus(status) ? status : undefined,
      cap: url.searchParams.get("cap") ?? undefined,
      zone_label: url.searchParams.get("zone") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      invoice:
        invoice === "richiesta" || invoice === "fatturata" ? invoice : undefined,
      loan:
        url.searchParams.get("loan") === "attivo" ||
        url.searchParams.get("loan") === "ritirato" ||
        url.searchParams.get("loan") === "convertito"
          ? (url.searchParams.get("loan") as "attivo" | "ritirato" | "convertito")
          : undefined,
      upsell_min: (() => {
        const v = Number(url.searchParams.get("upsell_min"));
        return Number.isFinite(v) && v > 0 ? v : undefined;
      })(),
    });
    return NextResponse.json<ApiResponse<ZoneClient[]>>({
      success: true,
      data: clients,
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
  const id = str(body.id).trim();
  const name = str(body.name).trim();
  if (!id || !name) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi obbligatori: id (place_id), name." },
      { status: 400 },
    );
  }
  const input: UpsertClientInput = {
    id,
    name,
    category: str(body.category),
    address: str(body.address),
    phone: str(body.phone),
    lat: typeof body.lat === "number" ? body.lat : null,
    lng: typeof body.lng === "number" ? body.lng : null,
    maps_url: str(body.maps_url),
    nfc_review_url: str(body.nfc_review_url),
    rating: typeof body.rating === "number" ? body.rating : 0,
    reviews: typeof body.reviews === "number" ? body.reviews : 0,
    zone_label: str(body.zone_label),
    status: isStatus(body.status) ? body.status : undefined,
  };
  try {
    const client = await upsertClient(input);
    return NextResponse.json<ApiResponse<ZoneClient>>({ success: true, data: client });
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
  const id = str(body.id).trim();
  if (!id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: id." },
      { status: 400 },
    );
  }
  if ("status" in body && !isStatus(body.status)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: `Stato non valido. Ammessi: ${ZONE_STATUSES.join(", ")}.` },
      { status: 400 },
    );
  }
  if (
    "invoice_status" in body &&
    !["", "richiesta", "fatturata"].includes(String(body.invoice_status))
  ) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Stato fattura non valido ('' | richiesta | fatturata)." },
      { status: 400 },
    );
  }
  try {
    // Azione dedicata: baseline delta "a oggi" (solo se assente).
    if (body.set_baseline === true) {
      const client = await setBaselineNow(id);
      if (!client) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Cliente non trovato nel registro." },
          { status: 404 },
        );
      }
      return NextResponse.json<ApiResponse<ZoneClient>>({ success: true, data: client });
    }
    const client = await updateClient(id, body);
    if (!client) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Cliente non trovato nel registro." },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiResponse<ZoneClient>>({ success: true, data: client });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
