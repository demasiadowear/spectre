import { NextResponse } from "next/server";
import { refreshClientReviews } from "@/lib/zone/db";
import { fetchPlaceRating } from "@/lib/zone/google";
import type { ApiResponse } from "@/types";
import type { ZoneClient } from "@/types/zone";

// POST /api/zone/refresh — "Aggiorna dati" sulla scheda cliente:
// UNA Place Details per il singolo place_id (voto + n. recensioni
// attuali), senza rifare lo scan di zona. Dietro JWT.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "GOOGLE_PLACES_API_KEY mancante." },
      { status: 500 },
    );
  }

  try {
    const found = await fetchPlaceRating(id);
    if (!found) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Google non risponde per questa attività: riprova." },
        { status: 502 },
      );
    }
    const client = await refreshClientReviews(id, found.rating, found.reviews);
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
