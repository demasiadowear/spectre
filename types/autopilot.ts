// ============================================================
// AYRO SPECTRE — Autopilot types
// Pipeline autonoma: scout -> study -> WA outreach -> demo ->
// escalation a Puccio / archivio.
// ============================================================

/** Stadi della pipeline Autopilot (dashboard pipeline view). */
export type AutopilotStage =
  | "nuovo"
  | "studiato"
  | "contattato"
  | "demo_richiesta"
  | "escalation"
  | "archiviato";

/** Tier scoring: T1 >=4.8/100+ rec, T2 >=4.6/50+, T3 >=4.5/30+. */
export type AutopilotTier = "T1" | "T2" | "T3";

/** Stato approvazione del primo messaggio WA (warm-up: review manuale). */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "auto";

export type WaDirection = "in" | "out";

/** queued -> sent -> delivered -> read; failed su errore invio. */
export type WaMessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type BuildStatus =
  | "pending"
  | "scraping"
  | "building"
  | "deployed" // preview pronta, in attesa di approvazione Puccio
  | "approved" // approvata: il worker invia il link al cliente
  | "sent"
  | "failed";

/** Esito enrichment Stadio 1.5 (study_json sulla pipeline). */
export interface AutopilotStudy {
  /** Cosa amano i clienti, estratto dalle recensioni recenti. */
  review_highlights: string[];
  /** Recensioni recenti grezze passate a Gemini (testo troncato). */
  recent_reviews: { rating: number; text: string; when: string }[];
  /** Presenza digitale rilevata (best effort). */
  digital_presence: {
    instagram?: string;
    facebook?: string;
    on_platforms: string[]; // treatwell / justeat / thefork…
    replies_to_reviews?: boolean;
  };
  /** Gap analysis: cosa perde senza sito, calata sul caso concreto. */
  gaps: string[];
}

/** Riga pipeline joinata con il lead (vista dashboard + worker). */
export interface AutopilotLead {
  lead_id: string;
  stage: AutopilotStage;
  tier: AutopilotTier;
  place_id: string;
  category: string;
  city: string;
  brief: string;
  study: AutopilotStudy | null;
  wa_first_message: string;
  approval_status: ApprovalStatus;
  approved_at: string | null;
  contacted_at: string | null;
  followup1_at: string | null;
  followup2_at: string | null;
  escalated_at: string | null;
  escalation_reason: string;
  archived_reason: string;
  /** true = il bot non risponde più su questa chat (escalation). */
  bot_paused: boolean;
  created_at: string;
  updated_at: string;
  // Dal lead collegato.
  name: string;
  company: string;
  phone: string;
  rating: number;
  reviews: number;
  address: string;
}

export interface WaMessage {
  id: string;
  lead_id: string;
  direction: WaDirection;
  body: string;
  status: WaMessageStatus;
  wa_id: string;
  ai_generated: boolean;
  created_at: string;
}

export interface AutopilotBuild {
  id: string;
  lead_id: string;
  status: BuildStatus;
  /** Template ayromex-templates-gallery: editoriale/classico/minimal/pop/mono. */
  template: string;
  /** Sorgente dati scraping (es. justeat). */
  source: string;
  manifest_json: string;
  preview_url: string;
  error: string;
  created_at: string;
  updated_at: string;
}

export interface AutopilotAlert {
  id: string;
  type: string; // escalation / anomaly / demo_ready / info
  message: string;
  lead_id: string | null;
  read: boolean;
  created_at: string;
}

/** Coppia chiave/valore di autopilot_settings, già tipizzata. */
export interface AutopilotSettings {
  /** "1" = tutto fermo: niente invii, bot muto. */
  kill_switch: boolean;
  /** ISO della prima giornata di outreach (fa partire il warm-up). */
  warmup_started_at: string | null;
  /** Cap contatti nuovi/giorno in warm-up e a regime. */
  warmup_daily_cap: number;
  steady_daily_cap: number;
  /** Giorni di warm-up (approvazione manuale + cap ridotto). */
  warmup_days: number;
}

export interface AutopilotCounters {
  day: string; // YYYY-MM-DD Europe/Rome
  new_contacts: number;
  messages_sent: number;
}

export interface AutopilotStats {
  by_stage: Record<AutopilotStage, number>;
  today: AutopilotCounters;
  daily_cap: number;
  warmup_active: boolean;
  pending_approvals: number;
  unread_alerts: number;
  kill_switch: boolean;
}

/** Output Gemini per lo Stadio 1.5 (brief + primo messaggio). */
export interface StudyGeneration {
  brief: string;
  wa_message: string;
}
