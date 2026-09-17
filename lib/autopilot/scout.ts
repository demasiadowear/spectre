import { searchGooglePlaces } from "@/lib/hunter/google-places";
import { createLead } from "@/lib/data";
import { classifyPhone } from "@/lib/pitch";
import { isTursoConnected } from "@/lib/turso";
import type { RawLead } from "@/types/hunter";
import {
  SCOUT_CATEGORIES,
  SCOUT_LOCATIONS,
  SCOUT_MIN_RATING,
  SCOUT_MIN_REVIEWS,
  SCOUT_QUERIES_PER_RUN,
} from "./constants";
import { insertPipelineRow, knownPhones, knownPlaceIds, normalizePhone } from "./db";
import { loadLimits, modeAcceptsWebsite, type ScoutMode } from "@/lib/factory/scout-config";

// ============================================================
// Stadio 1 — SCOUT (cron giornaliero).
// Places Text Search su categorie×località ruotate, filtro
// rating>=4.5 / 30+ recensioni, dedup contro il DB, inserimento stato
// "da_contattare". Nessun prezzo automatico: rating+recensioni restano
// in meta (qualità), il prezzo lo mette Puccio a mano lead per lead.
//
// MODALITÀ (FACTORY_SCOUT_MODE, vedi lib/factory/scout-config.ts):
//   no_site   — solo attività senza sito. È il comportamento storico
//               (regola del 12/06/2026), ancora raggiungibile intatto.
//   weak_site — solo attività CON sito, da valutare con l'audit.
//   both      — entrambe (predefinito).
//
// Un lead con sito NON viene qualificato in base al sito qui: lo Scout
// non fa richieste HTTP ai siti dei prospect, perché è un cron che gira
// su decine di risultati. Il sito lo giudica `analyze_website` dentro la
// Factory, che ha tetti, timeout e punteggio spiegabile. Qui si decide
// solo CHI vale la pena guardare.
// ============================================================

export interface ScoutResult {
  queries: string[];
  found: number;
  qualified: number;
  inserted: number;
  skipped_duplicates: number;
  /** Modalità con cui è girato questo giro. */
  mode: ScoutMode;
  /** Quanti dei qualificati hanno già un sito (candidati "sito debole"). */
  with_website: number;
  /** Scartati perché la modalità non li ammette. */
  skipped_by_mode: number;
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

/** Qualità dell'attività: identica in tutte le modalità. Un'attività
 *  con due recensioni non diventa interessante perché ha un sito brutto. */
function hasQuality(lead: RawLead): boolean {
  return lead.rating >= SCOUT_MIN_RATING && lead.reviews >= SCOUT_MIN_REVIEWS;
}

export function qualifies(lead: RawLead, mode: ScoutMode): boolean {
  return hasQuality(lead) && modeAcceptsWebsite(mode, lead.has_website);
}

export async function runScout(): Promise<ScoutResult> {
  if (!isTursoConnected()) {
    throw new Error("Turso non configurato: lo scout richiede il DB.");
  }

  const limits = loadLimits();
  const queries = todaysQueries();
  const [placeIds, phones] = await Promise.all([knownPlaceIds(), knownPhones()]);

  const result: ScoutResult = {
    queries: queries.map((q) => `${q.category} a ${q.location}`),
    found: 0,
    qualified: 0,
    inserted: 0,
    skipped_duplicates: 0,
    mode: limits.mode,
    with_website: 0,
    skipped_by_mode: 0,
  };

  for (const { category, location } of queries) {
    const raw = await searchGooglePlaces({ category, location });
    result.found += raw.length;

    for (const r of raw) {
      if (!hasQuality(r)) continue;
      if (!modeAcceptsWebsite(limits.mode, r.has_website)) {
        result.skipped_by_mode++;
        continue;
      }
      result.qualified++;
      if (r.has_website) result.with_website++;

      const phone = normalizePhone(r.phone);
      if (placeIds.has(r.id) || (phone && phones.has(phone))) {
        result.skipped_duplicates++;
        continue;
      }

      const lead = await createLead({
        name: r.name,
        company: r.name,
        email: "",
        phone: r.phone,
        source: "maps",
        status: "todo",
        value: 0, // niente prezzo automatico: lo decide Puccio a mano
        probability: 0,
        last_contact: new Date().toISOString(),
        next_action: "Pipeline: study + primo contatto WA",
        notes: `Scout — ${category} a ${location}, ${r.rating}★ / ${r.reviews} recensioni, ${
          r.has_website ? `sito da valutare: ${r.website}` : "senza sito"
        }.`,
        tags: ["autopilot", category.split(" ")[0]],
        meta: {
          rating: r.rating,
          reviews: r.reviews,
          address: r.address,
          category,
          city: location,
          lat: r.lat,
          lng: r.lng,
          phone_type: classifyPhone(r.phone),
          // Il sito va in meta anche quando è vuoto: analyze_website
          // legge da qui, e "" significa "nessun sito", che è un dato.
          website: r.website ?? "",
          has_website: r.has_website,
        },
      });

      await insertPipelineRow({
        lead_id: lead.id,
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
