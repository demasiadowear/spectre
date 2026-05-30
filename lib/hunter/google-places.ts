import type { HunterParams, RawLead } from "@/types/hunter";

// ============================================================
// Google Maps search via the Google Places API (legacy). Server-only
// (reads GOOGLE_PLACES_API_KEY). Flow: Geocode city -> Nearby Search ->
// Place Details (phone + website). Errors are non-blocking: on any
// failure we return [] and the caller falls back to mock data.
// Results cached 5 min per query to stay well under the free tier.
// ============================================================

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RADIUS_M = 50_000; // Google Nearby Search hard cap.
const MAX_DETAILS = 20; // Cap Place Details lookups (cost control).

interface CacheEntry {
  at: number;
  leads: RawLead[];
}

const cache = new Map<string, CacheEntry>();

function cacheKey(params: HunterParams): string {
  return [
    params.category.toLowerCase().trim(),
    params.location.toLowerCase().trim(),
    params.radius ?? 0,
    params.limit ?? 20,
  ].join("|");
}

// Map a few Italian category terms to a Google Places `type`. Anything
// not listed falls back to a free-text `keyword` search (more flexible
// for terms like "tattoo studio" or "trattoria").
const CATEGORY_TYPE: Record<string, string> = {
  parrucchiere: "hair_care",
  barbiere: "hair_care",
  estetista: "beauty_salon",
  palestra: "gym",
  ristorante: "restaurant",
  pizzeria: "restaurant",
  trattoria: "restaurant",
  bar: "bar",
  dentista: "dentist",
  avvocato: "lawyer",
  commercialista: "accounting",
};

function mapCategoryToType(category: string): string | null {
  return CATEGORY_TYPE[category.toLowerCase().trim()] ?? null;
}

interface GeocodeResponse {
  status?: string;
  results?: { geometry?: { location?: { lat: number; lng: number } } }[];
}

interface NearbyPlace {
  place_id?: string;
  name?: string;
  vicinity?: string;
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
  geometry?: { location?: { lat?: number; lng?: number } };
}

interface NearbyResponse {
  status?: string;
  results?: NearbyPlace[];
}

interface PlaceDetail {
  name?: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  url?: string;
}

interface DetailsResponse {
  status?: string;
  result?: PlaceDetail;
}

async function geocodeCity(
  city: string,
  key: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", city);
  url.searchParams.set("key", key);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as GeocodeResponse;
  return json.results?.[0]?.geometry?.location ?? null;
}

async function fetchDetails(
  placeId: string,
  key: string,
): Promise<PlaceDetail | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set(
    "fields",
    "name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,url",
  );
  url.searchParams.set("key", key);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as DetailsResponse;
  return json.result ?? null;
}

function toRawLead(
  place: NearbyPlace,
  detail: PlaceDetail | null,
  fallbackCategory: string,
  index: number,
): RawLead {
  const website =
    typeof detail?.website === "string" ? detail.website.trim() : "";
  const lat = place.geometry?.location?.lat;
  const lng = place.geometry?.location?.lng;
  return {
    id: place.place_id || `gplaces-${index}`,
    name: detail?.name || place.name || "Attività senza nome",
    category: place.types?.[0] || fallbackCategory,
    address: detail?.formatted_address || place.vicinity || "",
    phone: detail?.formatted_phone_number ?? "",
    rating:
      typeof detail?.rating === "number"
        ? detail.rating
        : typeof place.rating === "number"
          ? place.rating
          : 0,
    reviews:
      typeof detail?.user_ratings_total === "number"
        ? detail.user_ratings_total
        : typeof place.user_ratings_total === "number"
          ? place.user_ratings_total
          : 0,
    has_website: website.length > 0,
    website: website.length > 0 ? website : null,
    lat: typeof lat === "number" ? lat : undefined,
    lng: typeof lng === "number" ? lng : undefined,
  };
}

export async function searchGooglePlaces(
  params: HunterParams,
): Promise<RawLead[]> {
  if (!GOOGLE_PLACES_API_KEY) return [];

  const key = cacheKey(params);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.leads;
  }

  try {
    const apiKey = GOOGLE_PLACES_API_KEY;
    const coords = await geocodeCity(params.location, apiKey);
    if (!coords) {
      console.error("[hunter] geocode found no city:", params.location);
      return [];
    }

    const radiusM = Math.min(
      MAX_RADIUS_M,
      Math.round((params.radius ?? 5) * 1000),
    );
    const nearbyUrl = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
    );
    nearbyUrl.searchParams.set("location", `${coords.lat},${coords.lng}`);
    nearbyUrl.searchParams.set("radius", String(radiusM));
    nearbyUrl.searchParams.set("keyword", params.category);
    const type = mapCategoryToType(params.category);
    if (type) nearbyUrl.searchParams.set("type", type);
    nearbyUrl.searchParams.set("language", "it");
    nearbyUrl.searchParams.set("key", apiKey);

    const nearbyRes = await fetch(nearbyUrl.toString(), { cache: "no-store" });
    if (!nearbyRes.ok) {
      console.error("[hunter] Places nearby HTTP error:", nearbyRes.status);
      return [];
    }
    const nearby = (await nearbyRes.json()) as NearbyResponse;
    if (nearby.status && nearby.status !== "OK" && nearby.status !== "ZERO_RESULTS") {
      console.error("[hunter] Places nearby status:", nearby.status);
      return [];
    }

    const places = Array.isArray(nearby.results) ? nearby.results : [];
    const limit = Math.min(params.limit ?? 20, MAX_DETAILS);

    // Enrich each place with details (phone + website) in parallel.
    const leads = await Promise.all(
      places.slice(0, limit).map(async (place, i) => {
        const detail = place.place_id
          ? await fetchDetails(place.place_id, apiKey)
          : null;
        return toRawLead(place, detail, params.category, i);
      }),
    );

    cache.set(key, { at: Date.now(), leads });
    return leads;
  } catch (err) {
    console.error(
      "[hunter] Google Places request failed:",
      (err as Error).message,
    );
    return [];
  }
}
