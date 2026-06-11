import { searchGooglePlaces } from "@/lib/hunter/google-places";
import { isTursoConnected } from "@/lib/turso";
import { buildDedupIndex, insertCase, isDuplicate } from "./db";

// ============================================================
// DETECTIVE scout — mode "audit": filtro INVERSO rispetto allo
// scout Autopilot. Pesca attività che HANNO un sito web, stessa
// zona Bari/provincia, verticale salone/estetica/parrucchiere.
// Dedup obbligatoria contro TUTTO il DB SPECTER prima di inserire.
// ============================================================

export const AUDIT_CATEGORIES = [
  "parrucchiere",
  "centro estetico",
  "salone di bellezza",
] as const;

export const AUDIT_LOCATIONS = [
  "Bari",
  "Modugno",
  "Bitonto",
  "Molfetta",
  "Triggiano",
  "Giovinazzo",
] as const;

/** Requisiti minimi: attività viva e con una reputazione da analizzare. */
const MIN_REVIEWS = 15;

export interface AuditScoutResult {
  queries: string[];
  found: number;
  with_website: number;
  inserted: number;
  skipped_duplicates: number;
}

export interface AuditScoutParams {
  /** Default: tutte le AUDIT_CATEGORIES. */
  categories?: string[];
  /** Default: tutte le AUDIT_LOCATIONS. */
  locations?: string[];
  /** Tetto inserimenti per run (partita controllata, no cron). */
  limit?: number;
}

export async function runAuditScout(
  params: AuditScoutParams = {},
): Promise<AuditScoutResult> {
  if (!isTursoConnected()) {
    throw new Error("Turso non configurato: lo scout audit richiede il DB.");
  }

  const categories = params.categories?.length
    ? params.categories
    : [...AUDIT_CATEGORIES];
  const locations = params.locations?.length
    ? params.locations
    : [...AUDIT_LOCATIONS];
  const limit = params.limit ?? 30;

  const index = await buildDedupIndex();
  const result: AuditScoutResult = {
    queries: [],
    found: 0,
    with_website: 0,
    inserted: 0,
    skipped_duplicates: 0,
  };

  for (const category of categories) {
    for (const location of locations) {
      if (result.inserted >= limit) return result;
      result.queries.push(`${category} a ${location}`);

      const raw = await searchGooglePlaces({ category, location });
      result.found += raw.length;

      for (const r of raw) {
        if (result.inserted >= limit) break;
        // Filtro inverso: CON sito web proprio.
        if (!r.has_website || !r.website) continue;
        if (r.reviews < MIN_REVIEWS) continue;
        result.with_website++;

        if (isDuplicate(index, { place_id: r.id, name: r.name, phone: r.phone })) {
          result.skipped_duplicates++;
          continue;
        }

        await insertCase({
          place_id: r.id,
          business_name: r.name,
          website_url: r.website,
          phone: r.phone,
          city: location,
          category,
        });

        index.placeIds.add(r.id);
        index.names.add(r.name.toLowerCase().trim());
        result.inserted++;
      }
    }
  }
  return result;
}
