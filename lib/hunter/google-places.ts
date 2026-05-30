import type { HunterParams, RawLead } from "@/types/hunter";

// ============================================================
// Lead Hunter search via the Google Places API (New) Text Search.
// Server-only (reads GOOGLE_PLACES_API_KEY). Paginated POSTs (up to 3
// pages ≈ 60 results) to places:searchText return name, address, phone,
// website, rating and review count — no separate Geocoding or per-place
// Details requests, so website status is always authoritative (the
// New API ships websiteUri inside the search result). The large pool
// matters: the caller's only-no-website filter often drops most results.
// Errors are non-blocking: on any failure we return [] and the caller
// falls back to mock data. Results cached 5 min per query.
//
// Requires the "Places API (New)" enabled on the Google Cloud project
// (the legacy Places API is not available on newer projects).
// ============================================================

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const MAX_PAGES = 3; // 3 × 20 = up to 60 results
const PAGE_SIZE = 20; // Text Search (New) hard max per page

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  "nextPageToken",
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
  nextPageToken?: string;
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

async function fetchPage(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<TextSearchResponse | null> {
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      "[hunter] Places (New) HTTP error:",
      res.status,
      detail.slice(0, 300),
    );
    return null;
  }
  return (await res.json()) as TextSearchResponse;
}

export async function searchGooglePlaces(
  params: HunterParams,
): Promise<RawLead[]> {
  if (!GOOGLE_PLACES_API_KEY) return [];
  const apiKey = GOOGLE_PLACES_API_KEY;

  const key = cacheKey(params);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.leads;
  }

  try {
    // Text Search resolves the city from the query itself ("ristoranti a
    // Bari"), so no Geocoding / locationBias is needed. We paginate up to
    // MAX_PAGES (≈60 results) so the caller's only-no-website filter has a
    // large pool. radius is not used by Text Search (ranks by relevance).
    const textQuery = `${params.category} a ${params.location}`.trim();
    const baseBody: Record<string, unknown> = {
      textQuery,
      languageCode: "it",
      pageSize: PAGE_SIZE,
    };

    const collected: NewPlace[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const body = pageToken ? { ...baseBody, pageToken } : baseBody;
      let json = await fetchPage(apiKey, body);

      // New-API page tokens are normally valid immediately; if a paged
      // request comes back empty, retry once after a short delay (token
      // propagation). No fixed delay on the happy path (that's legacy-only).
      if (pageToken && (!json || !json.places?.length)) {
        await sleep(1500);
        json = await fetchPage(apiKey, body);
      }
      if (!json) break;

      for (const p of json.places ?? []) {
        const id = p.id ?? "";
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        collected.push(p);
      }

      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }

    const leads = collected.map((p, i) => toRawLead(p, params.category, i));
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
