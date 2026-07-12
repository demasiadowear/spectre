import type { OpportunityTier, ZoneHuntResult, ZoneLead } from "@/types/zone";

// ============================================================
// ZONE HUNT — caccia per zona (cerchio su mappa) per la vendita
// porta-a-porta delle card NFC recensioni. Una Nearby Search per
// ogni gruppo di categorie da vetrina dentro il cerchio, dedup,
// ordinamento per INDICE OPPORTUNITÀ: in cima chi ha più bisogno
// di raccogliere recensioni (vendita facile), in fondo chi ne ha
// già migliaia (non compra) o ha un voto da problema di servizio
// (la card raccoglierebbe altre negative).
//
// Limite strutturale: Nearby Search (New) non ha paginazione (max 20
// risultati a richiesta) — il volume arriva dal numero di gruppi
// (9 × 20 = fino a ~180 candidati per zona).
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
  "places.businessStatus",
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
  businessStatus?: string;
}

// ----- Indice opportunità ------------------------------------------
// Progettato con Puccio per la vendita della card: il cliente ideale
// è "buon servizio, poca visibilità" (voto 3.5-4.4, poche recensioni,
// profilo reale). I saturi (>600 recensioni) e i disastri (<3.0, che
// hanno un problema di servizio, non di visibilità) vanno in fondo.

/** Fame di recensioni (0..1) — peso dominante dell'indice.
 *  Zero recensioni = fame massima SOLO con profilo reale (telefono +
 *  indirizzo): senza, è probabile scheda fantasma e viene declassata. */
function fame(reviews: number, hasPhone: boolean, hasAddress: boolean): number {
  if (reviews <= 30) {
    if (reviews === 0 && !(hasPhone && hasAddress)) return 0.35;
    return 1;
  }
  if (reviews <= 100) return 0.8;
  if (reviews <= 250) return 0.55;
  if (reviews <= 600) return 0.3;
  return 0.05;
}

/** Margine di miglioramento del voto (0..1): il pitch "ti alzo la
 *  media" funziona al massimo nella fascia 3.5-4.4. */
function margineVoto(rating: number): number {
  if (rating <= 0) return 0.5; // nessun voto: neutro (già premiato dalla fame)
  if (rating < 3) return 0.1;
  if (rating < 3.5) return 0.6;
  if (rating <= 4.4) return 1; // sweet spot commerciale
  return 0.4; // 4.5-5: già belli, gli vendi solo volume
}

export function opportunityScore(
  rating: number,
  reviews: number,
  hasPhone: boolean,
  hasAddress: boolean,
): number {
  const contattabilita = (hasPhone ? 0.6 : 0) + (hasAddress ? 0.4 : 0);
  const base =
    70 * fame(reviews, hasPhone, hasAddress) +
    15 * margineVoto(rating) +
    15 * contattabilita;
  // Sotto 3.0 il problema è il servizio, non la visibilità: la card
  // raccoglierebbe altre recensioni negative. Fuori dalla fascia calda.
  const malusServizio = rating > 0 && rating < 3 ? 0.5 : 1;
  return Math.round(base * malusServizio);
}

export function opportunityTier(score: number): OpportunityTier {
  if (score >= 70) return "caldo";
  if (score >= 40) return "tiepido";
  return "gia_a_posto";
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
        // DISTANCE, non POPULARITY (il default): con soli 20 slot per
        // gruppo, "per popolarità" riempie il paniere di attività già
        // sature di recensioni — l'esatto contrario del target card.
        // "Per distanza" campiona il vicinato com'è, incluse le
        // piccole invisibili che sono il compratore ideale.
        rankPreference: "DISTANCE",
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
      // Serrande abbassate fuori dal giro: se Google marca l'attività
      // come chiusa (temporaneamente o per sempre) non è un prospect.
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
      const rating = typeof p.rating === "number" ? p.rating : 0;
      const reviews =
        typeof p.userRatingCount === "number" ? p.userRatingCount : 0;
      const phone = p.nationalPhoneNumber ?? "";
      const address = p.formattedAddress || "";
      const score = opportunityScore(rating, reviews, phone.length > 0, address.length > 0);
      leads.push({
        id,
        name: p.displayName?.text || "Attività senza nome",
        category: group.label,
        address,
        phone,
        rating,
        reviews,
        score,
        tier: opportunityTier(score),
        lat: typeof p.location?.latitude === "number" ? p.location.latitude : null,
        lng: typeof p.location?.longitude === "number" ? p.location.longitude : null,
        maps_url:
          p.googleMapsUri ||
          `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id)}`,
      });
    }
  }

  // Opportunità più alta prima; a pari indice vince chi ha MENO
  // recensioni (più fame), poi il voto migliore (cliente più sano).
  leads.sort(
    (a, b) => b.score - a.score || a.reviews - b.reviews || b.rating - a.rating,
  );

  return { leads, count: leads.length, groups_failed: groupsFailed };
}
