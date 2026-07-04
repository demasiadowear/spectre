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
