import type { HunterParams, RawLead } from "@/types/hunter";

// ============================================================
// Lead Hunter search via the Google Places API (New) Text Search.
// Server-only (reads GOOGLE_PLACES_API_KEY). One POST to
// places:searchText returns name, address, phone, website, rating and
// review count in a single call — no separate Geocoding or per-place
// Details requests, so website status is always authoritative (the
// New API ships websiteUri inside the search result).
// Errors are non-blocking: on any failure we return [] and the caller
// falls back to mock data. Results cached 5 min per query.
//
// Requires the "Places API (New)" enabled on the Google Cloud project
// (the legacy Places API is not available on newer projects).
// ============================================================

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Only the fields we map to RawLead — keeps the response (and billing
// SKU tier) lean.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.types",
].join(",");

interface CacheEntry {
  at: number;
  leads: RawLead[];
}

const cache = new Map<string, CacheEntry>();

function cacheKey(params: HunterParams): string {
  return [
    params.category.toLowerCase().trim(),
    params.location.toLowerCase().trim(),
    params.limit ?? 20,
  ].join("|");
}

interface NewPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
}

interface TextSearchResponse {
  places?: NewPlace[];
}

function toRawLead(
  place: NewPlace,
  fallbackCategory: string,
  index: number,
): RawLead {
  const website =
    typeof place.websiteUri === "string" ? place.websiteUri.trim() : "";
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  return {
    id: place.id || `gplaces-${index}`,
    name: place.displayName?.text || "Attività senza nome",
    category: place.types?.[0] || fallbackCategory,
    address: place.formattedAddress || "",
    phone: place.nationalPhoneNumber ?? "",
    rating: typeof place.rating === "number" ? place.rating : 0,
    reviews:
      typeof place.userRatingCount === "number" ? place.userRatingCount : 0,
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
    // Text Search resolves the city from the query itself ("parrucchiere
    // a Bari"), so no separate Geocoding call is needed. radius is not
    // used by Text Search (it ranks by relevance); switch to searchNearby
    // + a geocoded centre if strict-radius filtering is ever required.
    const textQuery = `${params.category} a ${params.location}`.trim();
    const maxResultCount = Math.min(20, Math.max(1, params.limit ?? 20));

    const res = await fetch(SEARCH_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery, languageCode: "it", maxResultCount }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        "[hunter] Places (New) HTTP error:",
        res.status,
        detail.slice(0, 300),
      );
      return [];
    }

    const json = (await res.json()) as TextSearchResponse;
    const places = Array.isArray(json.places) ? json.places : [];
    const leads = places.map((p, i) => toRawLead(p, params.category, i));

    cache.set(key, { at: Date.now(), leads });
    return leads;
  } catch (err) {
    console.error(
      "[hunter] Places (New) request failed:",
      (err as Error).message,
    );
    return [];
  }
}
