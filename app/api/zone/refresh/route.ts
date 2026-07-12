import { NextResponse } from "next/server";
import { refreshClientReviews } from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type { ZoneClient } from "@/types/zone";

// POST /api/zone/refresh — "Aggiorna dati" sulla scheda cliente:
// UNA Place Details per il singolo place_id (voto + n. recensioni
// attuali), senza rifare lo scan di zona. Dietro JWT.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const DETAILS_URL = "https://places.googleapis.com/v1/places";

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
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: id (place_id)." },
      { status: 400 },
    );
  }
  if (!GOOGLE_PLACES_API_KEY) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "GOOGLE_PLACES_API_KEY mancante." },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${DETAILS_URL}/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: {
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "rating,userRatingCount",
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[zone/refresh] Details HTTP", res.status, detail.slice(0, 200));
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: `Google non risponde per questa attività (HTTP ${res.status}).` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as { rating?: number; userRatingCount?: number };
    const client = await refreshClientReviews(
      id,
      typeof json.rating === "number" ? json.rating : 0,
      typeof json.userRatingCount === "number" ? json.userRatingCount : 0,
    );
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
