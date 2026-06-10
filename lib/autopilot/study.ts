import { getLeadById, updateLead } from "@/lib/data";
import { geminiJSON } from "@/lib/gemini";
import { searchGooglePlaces } from "@/lib/hunter/google-places";
import { isTursoConnected, turso } from "@/lib/turso";
import type {
  AutopilotLead,
  AutopilotStudy,
  StudyGeneration,
} from "@/types/autopilot";
import { STUDY_SYSTEM_PROMPT } from "./constants";
import {
  getPipelineLead,
  getSettings,
  isWarmupActive,
  normalizePhone,
  placeIdInPipeline,
  updatePipeline,
} from "./db";

// ============================================================
// Stadio 1.5 — STUDY (enrichment + messaggio mirato).
// Per ogni lead "nuovo": recensioni recenti da Places Details,
// gap analysis, poi Gemini Flash genera lead brief (5 righe) e
// primo messaggio WA unico. In warm-up il messaggio finisce in
// coda "da approvare" (approval_status=pending), poi auto.
// ============================================================

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const DETAILS_URL = "https://places.googleapis.com/v1/places";

/** Prefisso del brief che marca un lead "da completare": dati Google
 *  non trovati, niente messaggio generato (mai dati inventati).
 *  runStudy lo esclude dalla selezione per non riprocessarlo in loop. */
export const INCOMPLETE_BRIEF_PREFIX = "DA COMPLETARE";

interface PlaceReview {
  rating?: number;
  relativePublishTimeDescription?: string;
  text?: { text?: string };
}

interface PlaceDetails {
  reviews?: PlaceReview[];
  websiteUri?: string;
  googleMapsUri?: string;
}

/** Places Details (New): le recensioni più rilevanti/recenti (max 5
 *  per contratto API). Errori non bloccanti: torna null e lo study
 *  procede senza recensioni. */
async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  if (!GOOGLE_PLACES_API_KEY || !placeId) return null;
  try {
    const res = await fetch(`${DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      cache: "no-store",
      headers: {
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "reviews,websiteUri,googleMapsUri",
      },
    });
    if (!res.ok) {
      console.error("[autopilot/study] Places Details HTTP", res.status);
      return null;
    }
    return (await res.json()) as PlaceDetails;
  } catch (err) {
    console.error("[autopilot/study] Details failed:", (err as Error).message);
    return null;
  }
}

/** Gap deterministici per categoria — base fattuale passata a Gemini,
 *  così il messaggio collega il gap al caso concreto senza inventare. */
function gapsFor(category: string): string[] {
  const base = [
    "invisibile nella ricerca Google locale: chi cerca la categoria in zona trova i concorrenti col sito",
    "nessuna vetrina propria di servizi e prezzi: il cliente decide solo dalle foto di Maps",
  ];
  if (category.includes("ristorante") || category.includes("enoteca")) {
    base.unshift(
      "prenotazioni e ordini passano da piattaforme con commissioni (JustEat/TheFork) invece che dal canale diretto",
    );
  } else if (category.includes("lido")) {
    base.unshift(
      "prenotazioni ombrelloni solo via telefono/DM: niente prenotazione diretta online",
    );
  } else {
    base.unshift(
      "appuntamenti solo via telefono/Instagram: niente prenotazione diretta (o commissioni Treatwell)",
    );
  }
  return base;
}

/** Lead importati da Visor: senza place_id (o senza rating) risolve
 *  l'attività su Places Text Search. Match SOLO per telefono o nome
 *  esatto: meglio nessun dato che il dato di un'altra attività. */
async function resolvePlace(
  lead: AutopilotLead,
): Promise<{ place_id: string; rating: number; reviews: number; address: string } | null> {
  const location = lead.city && lead.city !== "zona" ? lead.city : "Puglia";
  const results = await searchGooglePlaces({
    category: lead.company,
    location,
  });
  const phone = normalizePhone(lead.phone);
  const wanted = lead.company.toLowerCase().trim();
  const match = results.find(
    (r) =>
      (phone && r.phone && normalizePhone(r.phone) === phone) ||
      r.name.toLowerCase().trim() === wanted,
  );
  if (!match || !match.id || match.rating <= 0) return null;
  return {
    place_id: match.id,
    rating: match.rating,
    reviews: match.reviews,
    address: match.address,
  };
}

export type StudyOutcome = "studied" | "incomplete" | "failed";

export async function studyLead(lead: AutopilotLead): Promise<StudyOutcome> {
  // ----- Dati Places mancanti (import da Visor): risolvi prima ------
  if (!lead.place_id || lead.rating <= 0) {
    const found = await resolvePlace(lead);
    if (!found) {
      await updatePipeline(lead.lead_id, {
        brief: `${INCOMPLETE_BRIEF_PREFIX}: attività non trovata su Google Places (rating/recensioni non verificabili). Completa i dati a mano o archivia.`,
      });
      return "incomplete";
    }
    if (found.place_id !== lead.place_id && (await placeIdInPipeline(found.place_id))) {
      await updatePipeline(lead.lead_id, {
        stage: "archiviato",
        archived_reason: "duplicato: stessa attività già in pipeline (place_id)",
      });
      return "incomplete";
    }
    await updatePipeline(lead.lead_id, { place_id: found.place_id });
    const visorLead = await getLeadById(lead.lead_id);
    if (visorLead) {
      await updateLead(lead.lead_id, {
        meta: {
          ...visorLead.meta,
          rating: found.rating,
          reviews: found.reviews,
          address: visorLead.meta.address || found.address,
        },
      });
    }
    lead = {
      ...lead,
      place_id: found.place_id,
      rating: found.rating,
      reviews: found.reviews,
      address: lead.address || found.address,
    };
  }

  const details = await fetchPlaceDetails(lead.place_id);

  const recent = (details?.reviews ?? [])
    .filter((r) => r.text?.text)
    .slice(0, 10)
    .map((r) => ({
      rating: r.rating ?? 0,
      text: (r.text?.text ?? "").slice(0, 400),
      when: r.relativePublishTimeDescription ?? "",
    }));

  const study: AutopilotStudy = {
    review_highlights: [],
    recent_reviews: recent,
    digital_presence: { on_platforms: [] },
    gaps: gapsFor(lead.category),
  };

  const userPrompt = JSON.stringify({
    attivita: lead.company,
    categoria: lead.category,
    zona: `${lead.city} (${lead.address || "Puglia"})`,
    rating: lead.rating,
    recensioni_totali: lead.reviews,
    recensioni_recenti: recent,
    gap_senza_sito: study.gaps,
  });

  const generated = await geminiJSON<StudyGeneration>(
    STUDY_SYSTEM_PROMPT,
    userPrompt,
    { complex: true, temperature: 0.8 },
  );
  if (!generated?.brief || !generated?.wa_message) {
    console.error("[autopilot/study] Gemini vuoto per", lead.lead_id);
    return "failed";
  }

  // Highlights ricavabili a costo zero: le frasi chiave del brief le ha
  // già distillate Gemini; teniamo le recensioni grezze nello study.
  study.review_highlights = generated.brief
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);

  const settings = await getSettings();
  await updatePipeline(lead.lead_id, {
    stage: "studiato",
    brief: generated.brief.trim(),
    wa_first_message: generated.wa_message.trim(),
    study_json: JSON.stringify(study),
    approval_status: isWarmupActive(settings) ? "pending" : "auto",
  });
  return "studied";
}

export interface StudyResult {
  studied: number;
  incomplete: number;
  failed: number;
}

/** Studia fino a `limit` lead in stato "nuovo" (T1 prima), saltando
 *  quelli già marcati "da completare". */
export async function runStudy(limit = 10): Promise<StudyResult> {
  if (!isTursoConnected() || !turso) {
    throw new Error("Turso non configurato: lo study richiede il DB.");
  }
  const res = await turso.execute({
    sql: `SELECT p.*, l.name, l.company, l.phone, l.meta
          FROM autopilot_pipeline p JOIN leads l ON l.id = p.lead_id
          WHERE p.stage = 'nuovo'
            AND (p.brief IS NULL OR p.brief NOT LIKE '${INCOMPLETE_BRIEF_PREFIX}%')
          ORDER BY p.tier ASC, p.created_at ASC LIMIT ?`,
    args: [limit],
  });

  const result: StudyResult = { studied: 0, incomplete: 0, failed: 0 };
  for (const row of res.rows) {
    const lead = await getPipelineLead(String(row.lead_id));
    if (!lead) continue;
    const outcome = await studyLead(lead).catch((err): StudyOutcome => {
      console.error("[autopilot/study]", lead.lead_id, (err as Error).message);
      return "failed";
    });
    result[outcome]++;
  }
  return result;
}
