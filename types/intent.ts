// ============================================================
// Intent Scout — tipi. Lead "intent" = azienda/PMI che ha
// PUBBLICATO una richiesta per sito web / servizi digitali su
// una piattaforma freelance (AddLance, Freelanceboard).
// ============================================================

/** Funnel kanban dedicato ai lead intent. */
export type IntentStage =
  | "intent_found"
  | "contacted"
  | "meeting"
  | "won"
  | "lost";

/** Piattaforme supportate nella v1 (v. lib/intent/constants.ts per
 *  quelle escluse e perché). */
export type IntentPlatform = "addlance" | "freelanceboard";

/** Richiesta grezza estratta dallo scraper, prima di dedup/scoring. */
export interface RawIntentRequest {
  platform: IntentPlatform;
  title: string;
  body: string;
  category: string;
  zone: string;
  budget: string;
  /** ISO date; "" se la piattaforma non la espone. */
  published_at: string;
  source_url: string;
  /** Contatto visibile in chiaro (raro: quasi sempre dietro login). */
  contact: string;
}

/** Riga intent_pipeline + anagrafica del lead (join su leads). */
export interface IntentLead {
  lead_id: string;
  stage: IntentStage;
  platform: IntentPlatform;
  source_url: string;
  title: string;
  body: string;
  category: string;
  zone: string;
  budget: string;
  published_at: string;
  score: number;
  hook: string;
  notified: boolean;
  created_at: string;
  updated_at: string;
  // da leads
  name: string;
  company: string;
  phone: string;
  email: string;
}

export interface IntentScoutResult {
  scraped: number;
  matched: number;
  inserted: number;
  skipped_duplicates: number;
  notified: number;
  errors: string[];
}

export interface IntentStats {
  by_stage: Record<IntentStage, number>;
}

// ============================================================
// Aste giudiziarie (immobili residenziali) — sorgente aggiuntiva
// dello Scout: scraping Playwright della pagina Tribunale, dedup su
// tribunale+procedura+lotto, digest Telegram giornaliero ordinato per
// risparmio. Riusa browser/Gemini/Telegram del pipeline Intent.
// ============================================================

/** Lotto grezzo dallo scraper: campi best-effort + testo integrale
 *  della scheda per il parsing di fallback (regex robuste). */
export interface AsteRawLot {
  tribunale: string;
  procedura: string;
  lotto: string;
  comune: string;
  tipo: string;
  mq: string;
  vani: string;
  offerta_minima: string;
  valore_stima: string;
  data_asta: string;
  termine_offerte: string;
  /** Numero pubblicazione/tentativo d'asta (1 = prima, >=2 = già
   *  ribassato). Ricavato da numeroPubblicazione o numeroRibasso+1. */
  numero_pubblicazione: string;
  link: string;
  raw_text: string;
}

/** Lotto normalizzato + campi calcolati. */
export interface AsteLot {
  /** Chiave dedup: tribunale|procedura|lotto (normalizzata). */
  key: string;
  tribunale: string;
  procedura: string;
  lotto: string;
  comune: string;
  tipo: string;
  mq: number | null;
  vani: number | null;
  offerta_minima: number | null;
  valore_stima: number | null;
  /** Data asta in ISO (YYYY-MM-DD) o "". */
  data_asta: string;
  /** Termine presentazione offerte in ISO o "" (base dell'alert ⚠️). */
  termine_offerte: string;
  /** Numero pubblicazione/tentativo d'asta (>=2 = già ribassato,
   *  null = non esposto in lista). */
  numero_pubblicazione: number | null;
  link: string;
  /** (valore_stima - offerta_minima) / valore_stima, 0..1 (null se dati mancanti). */
  risparmio_pct: number | null;
  /** Giorni da oggi al termine offerte (negativo = scaduto, null = ignoto). */
  giorni_al_termine: number | null;
}

export interface AsteScoutResult {
  scraped: number;
  nuovi: number;
  aggiornati: number;
  digest_inviato: boolean;
  lotti_in_digest: number;
  /** Diagnostica: nomi dei campi JSON di perizia/stima osservati. */
  campi_perizia: string[];
  /** Diagnostica: nomi dei campi JSON di pubblicazione/ribasso osservati. */
  campi_pubblicazione: string[];
  errors: string[];
}
