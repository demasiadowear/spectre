import { NextResponse } from "next/server";
import { nfcReviewUrl } from "@/lib/zone/gpage";
import type { ApiResponse } from "@/types";
import type { ZoneLead } from "@/types/zone";

// POST /api/zone/search — ricerca attività per nome (aggiunta manuale
// al registro: il cliente che ti ferma per strada o ti contatta senza
// essere mai passato da uno scan). Text Search con lo stesso field
// mask della caccia, così il candidato arriva già col link NFC.
export const dynamic = "force-dynamic";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.googleMapsUri",
].join(",");

interface FoundPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
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
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  if (!q) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: q (nome attività)." },
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
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: city ? `${q}, ${city}` : q,
        languageCode: "it",
        pageSize: 8,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[zone/search] HTTP", res.status, detail.slice(0, 200));
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: `Ricerca Google fallita (HTTP ${res.status}).` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as { places?: FoundPlace[] };
    const candidates: ZoneLead[] = (json.places ?? [])
      .filter((p) => p.id)
      .map((p) => ({
        id: p.id as string,
        name: p.displayName?.text || "Attività senza nome",
        category: "",
        address: p.formattedAddress || "",
        phone: p.nationalPhoneNumber ?? "",
        rating: typeof p.rating === "number" ? p.rating : 0,
        reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : 0,
        score: 0,
        tier: "tiepido",
        lat: typeof p.location?.latitude === "number" ? p.location.latitude : null,
        lng: typeof p.location?.longitude === "number" ? p.location.longitude : null,
        maps_url:
          p.googleMapsUri ||
          `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.id as string)}`,
        nfc_review_url: p.googleMapsUri ? nfcReviewUrl(p.googleMapsUri) : null,
        saved_status: null,
      }));
    return NextResponse.json<ApiResponse<ZoneLead[]>>({
      success: true,
      data: candidates,
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
