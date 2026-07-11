import type { CareTier, ZoneHuntResult, ZoneLead } from "@/types/zone";

// ============================================================
// ZONE HUNT — caccia per zona (cerchio su mappa) per la vendita
// porta-a-porta delle card NFC recensioni. A differenza dell'Hunter
// classico (una categoria, una città) qui si spara UNA Nearby Search
// per ogni gruppo di categorie da vetrina dentro il cerchio, si
// deduplica e si ordina per "indice attenzione recensioni".
//
// Limite strutturale: Nearby Search (New) non ha paginazione (max 20
// risultati a richiesta) — il volume arriva dal numero di gruppi
// (9 × 20 = fino a ~180 candidati per zona). L'API non espone le
// risposte del titolare alle recensioni, quindi l'"attenzione" è un
// proxy: volume recensioni (peso 70) + voto (peso 30). Chi accumula
// tante recensioni con voto alto le sta già curando — ed è il
// compratore ideale della card.
// ============================================================

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const PAGE_MAX = 20; // hard max Nearby Search (New)

/** Gruppi di categorie Places (Table A) da vetrina/banco: attività
 *  con un bancone fisico dove la card NFC ha senso. Un gruppo che
 *  fallisce (tipo non valido, quota) non blocca gli altri. */
const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: "ristorazione", types: ["restaurant", "pizza_restaurant", "fast_food_restaurant"] },
  { label: "bar & caffè", types: ["bar", "cafe", "bakery", "ice_cream_shop"] },
  { label: "bellezza", types: ["hair_salon", "beauty_salon", "barber_shop", "nail_salon", "spa"] },
  { label: "salute", types: ["dentist", "physiotherapist", "veterinary_care"] },
  { label: "negozi", types: ["clothing_store", "shoe_store", "jewelry_store", "florist", "gift_shop"] },
  { label: "casa & tech", types: ["home_goods_store", "electronics_store", "hardware_store", "furniture_store"] },
  { label: "auto & moto", types: ["car_repair", "car_wash", "car_dealer"] },
  { label: "sport & animali", types: ["gym", "book_store", "pet_store"] },
  { label: "ospitalità", types: ["hotel", "bed_and_breakfast"] },
];

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

interface NearbyPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
}

/** Indice attenzione recensioni 0-100. Volume log-scalato che satura
 *  a ~400 recensioni (oltre, sei comunque al massimo dell'attenzione),
 *  voto normalizzato su 5. Zero recensioni = zero indice. */
export function reviewCareScore(rating: number, reviews: number): number {
  if (reviews <= 0 || rating <= 0) return 0;
  const volume = Math.min(1, Math.log10(1 + reviews) / Math.log10(1 + 400));
  const quality = Math.max(0, Math.min(1, rating / 5));
  return Math.round(volume * 70 + quality * 30);
}

export function careTier(score: number): CareTier {
  if (score >= 75) return "molto_attento";
  if (score >= 50) return "attento";
  return "tiepido";
}

async function fetchGroup(
  apiKey: string,
  group: { label: string; types: string[] },
  lat: number,
  lng: number,
  radius: number,
): Promise<NearbyPlace[] | null> {
  try {
    const res = await fetch(NEARBY_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: group.types,
        maxResultCount: PAGE_MAX,
        languageCode: "it",
        // POPULARITY favorisce le attività con più interazioni — coerente
        // con l'obiettivo (chi è già attivo su Maps).
        rankPreference: "POPULARITY",
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius },
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[zone] Nearby "${group.label}" HTTP ${res.status}:`,
        detail.slice(0, 200),
      );
      return null;
    }
    const json = (await res.json()) as { places?: NearbyPlace[] };
    return json.places ?? [];
  } catch (err) {
    console.error(`[zone] Nearby "${group.label}" failed:`, (err as Error).message);
    return null;
  }
}

export async function huntZone(
  lat: number,
  lng: number,
  radius: number,
): Promise<ZoneHuntResult> {
  if (!GOOGLE_PLACES_API_KEY) {
    throw new Error("GOOGLE_PLACES_API_KEY mancante: la caccia zona richiede Places.");
  }
  const apiKey = GOOGLE_PLACES_API_KEY;
  const r = Math.min(5000, Math.max(100, Math.round(radius)));

  const results = await Promise.all(
    TYPE_GROUPS.map(async (g) => ({
      group: g,
      places: await fetchGroup(apiKey, g, lat, lng, r),
    })),
  );

  const groupsFailed: string[] = [];
  const seen = new Set<string>();
  const leads: ZoneLead[] = [];

  for (const { group, places } of results) {
    if (places === null) {
      groupsFailed.push(group.label);
      continue;
    }
    for (const p of places) {
      const id = p.id ?? "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const rating = typeof p.rating === "number" ? p.rating : 0;
      const reviews =
        typeof p.userRatingCount === "number" ? p.userRatingCount : 0;
      const score = reviewCareScore(rating, reviews);
      leads.push({
        id,
        name: p.displayName?.text || "Attività senza nome",
        category: group.label,
        address: p.formattedAddress || "",
        phone: p.nationalPhoneNumber ?? "",
        rating,
        reviews,
        care_score: score,
        care_tier: careTier(score),
        lat: typeof p.location?.latitude === "number" ? p.location.latitude : null,
        lng: typeof p.location?.longitude === "number" ? p.location.longitude : null,
        maps_url:
          p.googleMapsUri ||
          `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id)}`,
      });
    }
  }

  // Più attente prima; a pari indice vince chi ha più recensioni.
  leads.sort(
    (a, b) => b.care_score - a.care_score || b.reviews - a.reviews,
  );

  return { leads, count: leads.length, groups_failed: groupsFailed };
}
