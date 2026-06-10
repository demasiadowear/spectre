import { searchGooglePlaces } from "@/lib/hunter/google-places";
import { createLead } from "@/lib/data";
import { isTursoConnected } from "@/lib/turso";
import type { RawLead } from "@/types/hunter";
import {
  SCOUT_CATEGORIES,
  SCOUT_LOCATIONS,
  SCOUT_MIN_RATING,
  SCOUT_MIN_REVIEWS,
  SCOUT_QUERIES_PER_RUN,
  TIER_VALUE,
  scoreTier,
} from "./constants";
import { insertPipelineRow, knownPhones, knownPlaceIds, normalizePhone } from "./db";

// ============================================================
// Stadio 1 — SCOUT (cron giornaliero).
// Places Text Search su categorie×località ruotate, filtro
// rating>=4.5 / 30+ recensioni / senza sito, tier scoring,
// dedup contro il DB SPECTRE, inserimento stato "nuovo".
// ============================================================

export interface ScoutResult {
  queries: string[];
  found: number;
  qualified: number;
  inserted: number;
  skipped_duplicates: number;
}

/** Combinazioni categoria×località del giorno: rotazione deterministica
 *  sul giorno dell'anno, così in ~10 giorni si copre tutta la griglia
 *  senza bruciare la quota Places in una run sola. */
export function todaysQueries(
  date = new Date(),
): { category: string; location: string }[] {
  const grid: { category: string; location: string }[] = [];
  for (const category of SCOUT_CATEGORIES) {
    for (const location of SCOUT_LOCATIONS) {
      grid.push({ category, location });
    }
  }
  const dayOfYear = Math.floor(
    (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000,
  );
  const start = (dayOfYear * SCOUT_QUERIES_PER_RUN) % grid.length;
  return Array.from(
    { length: SCOUT_QUERIES_PER_RUN },
    (_, i) => grid[(start + i) % grid.length],
  );
}

function qualifies(lead: RawLead): boolean {
  return (
    !lead.has_website &&
    lead.rating >= SCOUT_MIN_RATING &&
    lead.reviews >= SCOUT_MIN_REVIEWS
  );
}

export async function runScout(): Promise<ScoutResult> {
  if (!isTursoConnected()) {
    throw new Error("Turso non configurato: lo scout richiede il DB.");
  }

  const queries = todaysQueries();
  const [placeIds, phones] = await Promise.all([knownPlaceIds(), knownPhones()]);

  const result: ScoutResult = {
    queries: queries.map((q) => `${q.category} a ${q.location}`),
    found: 0,
    qualified: 0,
    inserted: 0,
    skipped_duplicates: 0,
  };

  for (const { category, location } of queries) {
    const raw = await searchGooglePlaces({ category, location });
    result.found += raw.length;

    for (const r of raw.filter(qualifies)) {
      result.qualified++;

      const phone = normalizePhone(r.phone);
      if (placeIds.has(r.id) || (phone && phones.has(phone))) {
        result.skipped_duplicates++;
        continue;
      }

      const tier = scoreTier(r.rating, r.reviews);
      const lead = await createLead({
        name: r.name,
        company: r.name,
        email: "",
        phone: r.phone,
        source: "maps",
        status: "todo",
        value: TIER_VALUE[tier],
        probability: tier === "T1" ? 40 : tier === "T2" ? 30 : 20,
        last_contact: new Date().toISOString(),
        next_action: "Autopilot: study + primo contatto WA",
        notes: `Autopilot scout — ${category} a ${location}, ${r.rating}★ / ${r.reviews} recensioni, senza sito.`,
        tags: ["autopilot", category.split(" ")[0], tier.toLowerCase()],
        meta: {
          rating: r.rating,
          reviews: r.reviews,
          address: r.address,
          category,
          lat: r.lat,
          lng: r.lng,
        },
      });

      await insertPipelineRow({
        lead_id: lead.id,
        tier,
        place_id: r.id,
        category,
        city: location,
      });

      placeIds.add(r.id);
      if (phone) phones.add(phone);
      result.inserted++;
    }
  }

  return result;
}
