import { searchGooglePlaces } from "@/lib/hunter/google-places";
import { isTursoConnected } from "@/lib/turso";
import { buildDedupIndex, insertCase, isDuplicate, normalizePhone } from "./db";
import {
  AUDIT_LIMIT_MAX,
  AUDIT_LIMIT_MIN,
  DEFAULT_AUDIT_CATEGORIES,
  DEFAULT_AUDIT_LIMIT,
  DEFAULT_AUDIT_LOCATIONS,
} from "./presets";

// ============================================================
// DETECTIVE scout — mode "audit": filtro INVERSO rispetto allo
// scout Autopilot. Pesca attività che HANNO un sito web, zona e
// categoria parametrizzabili dal form in dashboard (default v1:
// salone/estetica, Bari/provincia — vedi lib/detective/presets.ts).
// Dedup obbligatoria contro TUTTO il DB SPECTER prima di inserire.
// ============================================================

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
  /** Default: DEFAULT_AUDIT_CATEGORIES (v1: salone/estetica). */
  categories?: string[];
  /** Default: DEFAULT_AUDIT_LOCATIONS (v1: 6 località Bari/provincia). */
  locations?: string[];
  /** Tetto inserimenti per run (partita controllata, no cron). */
  limit?: number;
}

/** Normalizza una lista libera dal form: trim, scarta vuoti, dedup. */
function cleanList(values: string[] | undefined, fallback: string[]): string[] {
  const cleaned = (values ?? [])
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [...fallback];
}

export async function runAuditScout(
  params: AuditScoutParams = {},
): Promise<AuditScoutResult> {
  if (!isTursoConnected()) {
    throw new Error("Turso non configurato: lo scout audit richiede il DB.");
  }

  const categories = cleanList(params.categories, DEFAULT_AUDIT_CATEGORIES);
  const locations = cleanList(params.locations, DEFAULT_AUDIT_LOCATIONS);
  const limit = Math.min(
    AUDIT_LIMIT_MAX,
    Math.max(AUDIT_LIMIT_MIN, Math.round(params.limit ?? DEFAULT_AUDIT_LIMIT)),
  );

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
        // Senza questo, due schede Google diverse (place_id/nome
        // diversi) con LO STESSO telefono nella stessa run passavano
        // entrambe: isDuplicate controllava l'indice pre-esistente ma
        // non veniva mai aggiornato con i telefoni appena inseriti.
        const phone = normalizePhone(r.phone);
        if (phone) index.phones.add(phone);
        result.inserted++;
      }
    }
  }
  return result;
}
