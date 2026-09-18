// ============================================================
// Il risultato di una raccolta, reso leggibile dai log — senza che
// nessun dato dell'attivita ci finisca dentro.
//
// Serve perche un `200` sulla rotta non dice se il job e riuscito: lo
// dice il corpo, che nei log non c'e. Chi guarda i log dall'esterno
// deve poter sapere com'e andata senza aprire la dashboard e senza
// rieseguire niente.
//
// REGOLA: da qui escono NUMERI e ENUM. Mai un nome, un telefono,
// un'email, un indirizzo, un URL, un frammento del dossier, un token.
// Passano solo `job_id` e `lead_id`, che sono identificativi interni e
// servono a ricollegare la riga al lavoro.
//
// Il motivo per cui `error_code` e un codice e non un messaggio: un
// messaggio d'errore contiene quasi sempre l'URL che ha fallito, cioe
// il sito del prospect. Un codice no.
// ============================================================

import type {
  BusinessDossier, CollectPhase, CommercialRecommendation, ContentReadiness,
  DossierRecommendation, MediaReadiness, PhaseState, SocialReadiness,
} from "@/types/dossier";
import { contiSocial } from "./decisione";

export const EVENTO_RACCOLTA = "collector_run_finished";
export const EVENTO_LETTURA = "collector_dossier_read";

/** Insieme chiuso di cause. Nessuna deriva da un messaggio libero. */
export type ErrorCode =
  | ""
  | "places_not_configured"
  | "places_no_match"
  | "places_unavailable"
  | "site_not_declared"
  | "site_unreachable"
  | "site_blocked"
  | "browser_required"
  | "database_unavailable"
  | "job_not_claimed"
  | "factory_paused"
  | "internal_error";

/**
 * Dove si e fermata la scoperta social, in una parola.
 *
 * La catena ha cinque anelli e ognuno si rompe in modo diverso. Senza
 * distinguerli, «zero profili» sembra sempre lo stesso guasto: il primo
 * rilancio reale ha risposto `no_results` con quattro query e 3206
 * token spesi, e da li non si poteva dire se la ricerca non avesse
 * trovato fonti o se i reindirizzamenti non si stessero risolvendo.
 */
export type SearchOutcome =
  | ""                        // la ricerca non e stata tentata
  | "search_unavailable"      // il grounding non c'e con questo modello
  | "no_sources"              // Google Search non ha trovato fonti
  | "redirects_broken"        // ha citato, ma i redirect non si risolvono
  | "sources_not_social"      // fonti trovate, nessuna era un profilo
  | "candidates_unverified"   // profili candidati, identita non verificata
  | "confirmed";              // discovery end-to-end riuscita

export function esitoRicerca(
  d: BusinessDossier | null,
  confermati: number,
): SearchOutcome {
  const s = d?.search;
  if (!s || !s.status) return "";
  if (s.status === "search_unavailable") return "search_unavailable";
  if (s.status === "not_configured") return "";

  const citazioni = s.citations ?? 0;
  const risolti = s.resolved ?? 0;
  const profili = s.profiles ?? 0;

  if (confermati > 0) return "confirmed";
  if (profili > 0) return "candidates_unverified";
  if (risolti > 0) return "sources_not_social";
  if (citazioni > 0) return "redirects_broken";
  return "no_sources";
}

export interface RiepilogoRaccolta {
  event: string;
  job_id: string;
  lead_id: string;
  status: "completed" | "failed";
  /** @deprecated Vale `commercial_recommendation`: resta perche i log
   *  gia raccolti si leggono con questo nome. */
  recommendation: DossierRecommendation | "";
  /** Le tre decisioni separate. Una riga di log con la sola
   *  raccomandazione non permetteva di distinguere «non vale la pena»
   *  da «mi manca il materiale»: sono due problemi con due rimedi. */
  commercial_recommendation: CommercialRecommendation | "";
  content_readiness: ContentReadiness | "";
  media_readiness: MediaReadiness | "";
  social_readiness: SocialReadiness | "";
  website_opportunity_score: number | null;
  duration_ms: number;
  phase_statuses: Record<string, string>;
  verified_facts_count: number;
  conflicts_count: number;
  blocking_conflicts_count: number;
  media_candidates_count: number;
  media_approved_count: number;
  /** I profili per stato. Uno solo — `confirmed` — puo entrare nel
   *  sito; gli altri servono a una persona che guarda. Contarli tutti
   *  e cio che permette di distinguere «non abbiamo cercato» da «non
   *  siamo riusciti a leggere» da «abbiamo letto e non erano suoi». */
  social_confirmed_count: number;
  social_likely_count: number;
  social_unverified_count: number;
  social_browser_required_count: number;
  social_rejected_count: number;
  /** Immagini che si possono davvero mostrare, non solo possedere. */
  media_displayable_count: number;
  /** Costo della scoperta social: se sale senza che salgano i profili
   *  confermati, la ricerca sta pagando per niente. */
  search_status: string;
  search_queries: number;
  search_tokens: number;
  /** Dove si e fermata la scoperta: citate -> risolte -> profili. */
  search_citations: number;
  search_resolved: number;
  search_profiles: number;
  /** La scoperta e stata riusata invece di rifarla. */
  search_cache_hit: boolean;
  /** Un operatore ne ha chiesto il rifacimento esplicito. */
  search_force_refresh: boolean;
  /** Dove si e fermata la catena, in una parola. Vedi `esitoRicerca`. */
  search_outcome: SearchOutcome;
  /** Le fasi CHIESTE e quelle ESEGUITE. Senza entrambe, una raccolta
   *  completa e un rilancio mirato si confondono. */
  requested_phases: string;
  executed_phases: string;
  error_code: ErrorCode;
  error_phase: CollectPhase | "";
}

/**
 * Classifica il motivo di un fallimento in un codice chiuso.
 *
 * Lavora sul testo del dettaglio ma non lo restituisce MAI: quel testo
 * contiene URL e nomi di host, e sarebbe il modo piu facile di far
 * finire il sito di un prospect dentro un log.
 */
export function classificaErrore(fase: CollectPhase, dettaglio: string): ErrorCode {
  const d = (dettaglio || "").toLowerCase();

  if (fase === "places") {
    if (d.includes("non configurata")) return "places_not_configured";
    if (d.includes("corrispondenza") || d.includes("nessun risultato")) return "places_no_match";
    return "places_unavailable";
  }
  if (fase === "official_site") {
    if (d.includes("nessun sito")) return "site_not_declared";
    if (d.includes("blocked") || d.includes("403") || d.includes("401") || d.includes("429")) {
      return "site_blocked";
    }
    if (d.includes("browser")) return "browser_required";
    return "site_unreachable";
  }
  if (fase === "social_discovery") return "browser_required";
  return "internal_error";
}

export interface ContestoRiepilogo {
  job_id: string;
  lead_id: string;
  status: "completed" | "failed";
  duration_ms: number;
  /** Codice gia noto (pausa, claim mancato, database): ha la precedenza
   *  sulla classificazione delle fasi. */
  error_code?: ErrorCode;
}

/** Costruisce il riepilogo da un dossier gia prodotto o gia salvato.
 *  Gli stessi numeri valgono per una raccolta appena finita e per una
 *  riletta dal database: cosi un risultato gia in archivio torna
 *  osservabile al primo caricamento, senza rieseguire niente. */
export function riepilogo(
  dossier: BusinessDossier | null,
  phases: PhaseState[],
  ctx: ContestoRiepilogo,
  event: string = EVENTO_RACCOLTA,
): RiepilogoRaccolta {
  const stati: Record<string, string> = {};
  for (const p of phases) stati[p.phase] = p.status;

  const fallita = phases.find((p) => p.status === "failed");
  const codice = ctx.error_code
    ? ctx.error_code
    : fallita ? classificaErrore(fallita.phase, fallita.detail) : "";

  const identita = dossier?.identities ?? [];
  const media = dossier?.media;
  const social = contiSocial(identita);
  const confermati = social.confirmed;

  // Le fasi CHIESTE vengono dal dossier quando ci sono; altrimenti si
  // deducono da quelle non saltate. La deduzione e un ripiego per i
  // dossier vecchi, non la fonte: se fosse l'unica, una raccolta
  // completa e un rilancio mirato resterebbero indistinguibili.
  const chieste = dossier?.requested_phases?.length
    ? dossier.requested_phases
    : phases.filter((p) => p.status !== "skipped").map((p) => p.phase);

  return {
    event,
    job_id: ctx.job_id,
    lead_id: ctx.lead_id,
    status: ctx.status,
    recommendation: dossier?.recommendation ?? "",
    commercial_recommendation: dossier?.commercial_recommendation ?? "",
    content_readiness: dossier?.content_readiness ?? "",
    media_readiness: dossier?.media_readiness ?? "",
    social_readiness: dossier?.social_readiness ?? "",
    website_opportunity_score: dossier?.website_opportunity_score ?? null,
    duration_ms: Math.max(0, Math.round(ctx.duration_ms)),
    phase_statuses: stati,
    // Tutti con `?.`: un dossier salvato illeggibile ripiega su `{}`, e
    // il riepilogo non deve essere cio che fa cadere la richiesta. Una
    // telemetria che si rompe fa perdere anche il motivo per cui si e
    // rotta.
    verified_facts_count: dossier?.verified?.length ?? 0,
    conflicts_count: dossier?.conflicts?.length ?? 0,
    blocking_conflicts_count: (dossier?.conflicts ?? []).filter((c) => c.blocking).length,
    media_candidates_count: media?.candidates?.length ?? 0,
    media_approved_count: media?.approved_ids?.length ?? 0,
    media_displayable_count: media?.counts?.utilizzabili_in_demo ?? 0,
    search_status: dossier?.search?.status ?? "",
    search_queries: dossier?.search?.queries ?? 0,
    search_tokens: dossier?.search?.tokens ?? 0,
    search_citations: dossier?.search?.citations ?? 0,
    search_resolved: dossier?.search?.resolved ?? 0,
    search_profiles: dossier?.search?.profiles ?? 0,
    search_cache_hit: dossier?.search?.cache_hit === true,
    search_force_refresh: dossier?.search?.force_refresh === true,
    search_outcome: esitoRicerca(dossier, confermati),
    requested_phases: chieste.join("+") || "-",
    executed_phases: phases.filter((p) => p.status !== "skipped")
      .map((p) => p.phase).join("+") || "-",
    social_confirmed_count: social.confirmed,
    social_likely_count: social.likely,
    social_unverified_count: social.unverified_candidate,
    social_browser_required_count: social.browser_required,
    social_rejected_count: social.rejected,
    error_code: codice,
    error_phase: fallita?.phase ?? "",
  };
}

/**
 * L'esito del JOB, ricavato dalle fasi di un dossier gia salvato.
 *
 * Una fase fallita non e un job fallito: se il dossier esiste ed e
 * stato salvato, il lavoro e arrivato in fondo e ha prodotto un
 * risultato parziale — che per un'attivita senza sito web e il caso
 * NORMALE, non un guasto. Solo quando nessuna fase e riuscita non c'e
 * niente di utilizzabile, e allora il job e fallito davvero.
 *
 * La differenza conta perche `status` e il campo su cui si contano gli
 * errori: segnare `failed` un job riuscito a meta fa suonare l'allarme
 * per ogni lead senza sito, e un allarme che suona sempre viene
 * ignorato anche quando serve.
 */
export function statoDaFasi(phases: PhaseState[]): "completed" | "failed" {
  const eseguite = phases.filter((p) => p.status !== "skipped");
  if (eseguite.length === 0) return "failed";
  return eseguite.every((p) => p.status === "failed") ? "failed" : "completed";
}

/** Chiavi ammesse nella riga di log. Qualunque altra cosa non esce.
 *  E una lista bianca e non nera di proposito: aggiungere un campo al
 *  dossier non deve poterlo far comparire nei log per distrazione. */
const CHIAVI_AMMESSE: readonly string[] = [
  "event", "job_id", "lead_id", "status", "recommendation",
  "commercial_recommendation", "content_readiness", "media_readiness",
  "website_opportunity_score", "duration_ms",
  "phase_statuses", "verified_facts_count", "conflicts_count",
  "blocking_conflicts_count", "media_candidates_count", "media_approved_count",
  "media_displayable_count", "social_confirmed_count",
  "social_browser_required_count", "search_status", "search_queries",
  "search_tokens", "search_citations", "search_resolved", "search_profiles",
  "search_cache_hit", "search_force_refresh", "search_outcome",
  "requested_phases", "executed_phases",
  "error_code", "error_phase",
];

/** Filtra sulla lista bianca prima di serializzare. */
export function soloCampiAmmessi(r: RiepilogoRaccolta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CHIAVI_AMMESSE) {
    const v = (r as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Una riga sola, JSON, su stdout. Vercel la raccoglie cosi com'e. */
export function scriviRiepilogo(r: RiepilogoRaccolta): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(soloCampiAmmessi(r)));
}

/**
 * Dallo stato del job al codice HTTP.
 *
 * Un `200` su un job fallito rende i log inutili: chi li guarda vede
 * solo richieste riuscite. E un `502` su qualunque fallimento e
 * altrettanto inutile al contrario, perche mette insieme «Places non
 * risponde» e «ho un difetto nel codice», che si sistemano in modi
 * opposti.
 */
export function statoHttp(stato: string, code: ErrorCode): number {
  if (stato === "completed") return 200;          // GO, REVIEW o REJECT: il job ha concluso
  if (stato === "not_claimed") return 202;        // lo sta gia eseguendo qualcun altro
  if (stato === "paused") return 503;             // FACTORY_PAUSED: riprovare piu tardi
  if (stato === "no_db") return 503;              // runtime non disponibile

  // `failed`: dipende da CHI ha fallito.
  switch (code) {
    case "places_not_configured":
      return 503;                                  // manca configurazione, non e un guasto
    case "places_unavailable":
    case "places_no_match":
    case "site_unreachable":
    case "site_blocked":
    case "browser_required":
      return 424;                                  // dipendenza esterna
    case "database_unavailable":
      return 503;
    case "job_not_claimed":
      return 409;                                  // conflitto sullo stato del job
    default:
      return 500;                                  // inatteso: e nostro
  }
}
