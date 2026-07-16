// ============================================================
// Place Details minimale (voto + n. recensioni) per un singolo
// place_id. Usata dal bottone "Aggiorna dati" e dal morning brief
// (refresh dei comodati in scadenza). Errori non bloccanti: null.
// ============================================================

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const DETAILS_URL = "https://places.googleapis.com/v1/places";

export interface PlaceRating {
  rating: number;
  reviews: number;
}

export async function fetchPlaceRating(placeId: string): Promise<PlaceRating | null> {
  if (!GOOGLE_PLACES_API_KEY || !placeId) return null;
  try {
    const res = await fetch(`${DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      cache: "no-store",
      headers: {
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "rating,userRatingCount",
      },
    });
    if (!res.ok) {
      console.error("[zone/google] Details HTTP", res.status, placeId);
      return null;
    }
    const json = (await res.json()) as { rating?: number; userRatingCount?: number };
    return {
      rating: typeof json.rating === "number" ? json.rating : 0,
      reviews: typeof json.userRatingCount === "number" ? json.userRatingCount : 0,
    };
  } catch (err) {
    console.error("[zone/google]", (err as Error).message);
    return null;
  }
}
