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
  BusinessDossier, CollectPhase, DossierRecommendation, PhaseState,
} from "@/types/dossier";

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

export interface RiepilogoRaccolta {
  event: string;
  job_id: string;
  lead_id: string;
  status: "completed" | "failed";
  recommendation: DossierRecommendation | "";
  duration_ms: number;
  phase_statuses: Record<string, string>;
  verified_facts_count: number;
  conflicts_count: number;
  blocking_conflicts_count: number;
  media_candidates_count: number;
  media_approved_count: number;
  social_confirmed_count: number;
  social_browser_required_count: number;
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

  return {
    event,
    job_id: ctx.job_id,
    lead_id: ctx.lead_id,
    status: ctx.status,
    recommendation: dossier?.recommendation ?? "",
    duration_ms: Math.max(0, Math.round(ctx.duration_ms)),
    phase_statuses: stati,
    verified_facts_count: dossier?.verified.length ?? 0,
    conflicts_count: dossier?.conflicts.length ?? 0,
    blocking_conflicts_count: (dossier?.conflicts ?? []).filter((c) => c.blocking).length,
    media_candidates_count: media?.candidates.length ?? 0,
    media_approved_count: media?.approved_ids.length ?? 0,
    social_confirmed_count: identita.filter((i) => i.status === "verified").length,
    social_browser_required_count: identita.filter((i) => i.status === "browser_required").length,
    error_code: codice,
    error_phase: fallita?.phase ?? "",
  };
}

/** Chiavi ammesse nella riga di log. Qualunque altra cosa non esce.
 *  E una lista bianca e non nera di proposito: aggiungere un campo al
 *  dossier non deve poterlo far comparire nei log per distrazione. */
const CHIAVI_AMMESSE: readonly string[] = [
  "event", "job_id", "lead_id", "status", "recommendation", "duration_ms",
  "phase_statuses", "verified_facts_count", "conflicts_count",
  "blocking_conflicts_count", "media_candidates_count", "media_approved_count",
  "social_confirmed_count", "social_browser_required_count",
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
