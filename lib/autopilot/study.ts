import { getLeadById, updateLead } from "@/lib/data";
import { geminiJSON } from "@/lib/gemini";
import { isMobilePhone } from "@/lib/pitch";
import { searchGooglePlaces } from "@/lib/hunter/google-places";
import { isTursoConnected, turso } from "@/lib/turso";
import type { AutopilotLead, AutopilotStudy } from "@/types/autopilot";
import { buildStudyPrompt } from "./constants";
import { composeFirstMessage } from "./variants";
import {
  getPipelineLead,
  normalizePhone,
  placeIdInPipeline,
  updatePipeline,
} from "./db";

// ============================================================
// Stadio 1.5 — STUDY (enrichment + messaggio mirato).
// Per ogni lead "nuovo": recensioni recenti da Places Details,
// gap analysis, poi Gemini Flash genera lead brief (5 righe) e
// primo messaggio WA unico. Esito: stato "studiato" = pronto da
// contattare a mano (copilota manuale, nessuna coda di approvazione).
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

/** Brief di fallback se Gemini non risponde: solo dati veri del lead, niente
 *  numeri inventati (la riga reputazione compare solo se rating+recensioni
 *  ci sono davvero). Tiene il lead in pipeline invece di scartarlo. */
function localBrief(lead: AutopilotLead): string {
  const lines = [`${lead.company} — ${lead.category || "attività locale"} a ${lead.city}.`];
  if (lead.rating > 0 && lead.reviews > 0) {
    lines.push(
      `Reputazione Google: ${lead.rating.toFixed(1)}★ su ${Math.round(lead.reviews)} recensioni.`,
    );
  }
  lines.push(
    "Senza sito proprio: invisibile nella ricerca Google locale, nessuna vetrina di servizi/prezzi, prenotazioni solo via telefono o social.",
    "Angolo: prima impressione professionale + canale diretto, senza commissioni di piattaforma.",
  );
  return lines.join("\n");
}

export type StudyOutcome = "studied" | "incomplete" | "failed" | "archived" | "fisso";

/** Salva il tipo numero su leads.meta.phone_type (merge, no overwrite). */
async function savePhoneType(leadId: string, type: "mobile" | "fisso"): Promise<void> {
  const visorLead = await getLeadById(leadId);
  if (visorLead) {
    await updateLead(leadId, { meta: { ...visorLead.meta, phone_type: type } });
  }
}

export async function studyLead(lead: AutopilotLead): Promise<StudyOutcome> {
  // ----- Pre-check telefono ---------------------------------------
  // I fissi (080, 06, 02, …) non sono su WhatsApp: NON si studiano
  // (niente messaggio WA) ma restano in pipeline come "da chiamare".
  // Si marca phone_type=fisso così non rientrano più nella coda study.
  if (!isMobilePhone(lead.phone)) {
    await savePhoneType(lead.lead_id, "fisso");
    if (!lead.next_action) {
      await updatePipeline(lead.lead_id, { next_action: "numero fisso: chiama" });
    }
    return "fisso";
  }
  // Mobile: marca il tipo e procede con brief + messaggio WA.
  await savePhoneType(lead.lead_id, "mobile");

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

  // rating/recensioni a 0 = dato ASSENTE, non un valore reale: si passano
  // come null così Gemini non scrive mai "0 su Google" / "0 recensioni" nel
  // brief (stessa regola del messaggio, qui per il brief mostrato a Puccio).
  const userPrompt = JSON.stringify({
    attivita: lead.company,
    categoria: lead.category,
    zona: `${lead.city} (${lead.address || "Puglia"})`,
    rating: lead.rating > 0 ? lead.rating : null,
    recensioni_totali: lead.reviews > 0 ? lead.reviews : null,
    recensioni_recenti: recent,
    gap_senza_sito: study.gaps,
  });

  // Brief commerciale (5 righe) da Gemini. Il PRIMO messaggio WA NON arriva
  // più da Gemini: è una delle tre varianti deterministiche A/B/C (vedi
  // composeFirstMessage). Se Gemini è giù il lead non si perde: si usa un
  // brief locale e si procede comunque col messaggio.
  let generated: { brief?: string } | null = null;
  try {
    generated = await geminiJSON<{ brief?: string }>(
      buildStudyPrompt(),
      userPrompt,
      { complex: true, temperature: 0.8 },
    );
  } catch (err) {
    // geminiJSON oggi non lancia (cattura da sé e torna null), ma se un
    // giorno lo facesse il lead NON deve sparire: si scende su localBrief.
    console.warn(
      "[autopilot/study] geminiJSON ha lanciato, fallback locale per",
      lead.lead_id,
      (err as Error).message,
    );
  }
  const brief = generated?.brief?.trim() || localBrief(lead);
  if (!generated?.brief) {
    console.warn(
      "[autopilot/study] brief Gemini assente, uso brief locale per",
      lead.lead_id,
    );
  }

  // Primo messaggio: variante A/B/C deterministica per lead + complimento
  // costruito dai dati reali (rating/recensioni del singolo lead, mai
  // hardcoded; fallback se assenti). La variante si salva sul record.
  const { variant, message } = composeFirstMessage({
    lead_id: lead.lead_id,
    rating: lead.rating,
    reviews: lead.reviews,
    category: lead.category,
  });

  // Highlights ricavabili a costo zero: le frasi chiave del brief;
  // teniamo le recensioni grezze nello study.
  study.review_highlights = brief
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);

  // Lead pronto da contattare a mano: lo stage resta "da_contattare",
  // ora col primo messaggio preparato (wa_first_message) e la variante
  // usata (wa_variant). Nessuna coda di approvazione, nessun invio auto.
  await updatePipeline(lead.lead_id, {
    stage: "da_contattare",
    brief,
    wa_first_message: message,
    wa_variant: variant,
    study_json: JSON.stringify(study),
    approval_status: "auto",
  });
  return "studied";
}

export interface StudyResult {
  studied: number;
  incomplete: number;
  failed: number;
  /** Archiviati (es. duplicati). */
  archived: number;
  /** Numeri fissi: marcati phone_type=fisso, restano in pipeline (chiama). */
  fisso: number;
}

/** Prepara fino a `limit` lead "da contattare" ancora senza primo
 *  messaggio (quelli che lo Scout ha appena trovato), saltando quelli
 *  già marcati "da completare" e i numeri fissi già classificati. */
export async function runStudy(limit = 10): Promise<StudyResult> {
  if (!isTursoConnected() || !turso) {
    throw new Error("Turso non configurato: lo study richiede il DB.");
  }
  const res = await turso.execute({
    sql: `SELECT p.*, l.name, l.company, l.phone, l.meta
          FROM autopilot_pipeline p JOIN leads l ON l.id = p.lead_id
          WHERE p.stage = 'da_contattare'
            AND (p.wa_first_message IS NULL OR p.wa_first_message = '')
            AND (p.brief IS NULL OR p.brief NOT LIKE '${INCOMPLETE_BRIEF_PREFIX}%')
            AND (l.meta IS NULL OR l.meta NOT LIKE '%"phone_type":"fisso"%')
          ORDER BY p.created_at ASC LIMIT ?`,
    args: [limit],
  });

  const result: StudyResult = { studied: 0, incomplete: 0, failed: 0, archived: 0, fisso: 0 };
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
