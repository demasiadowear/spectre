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
  | "risposto_manuale" // risposta umana: bot muto, chat in mano a Puccio
  // --- stati trattativa: assegnati dal triage Gemini alla risposta
  //     umana (solo catalogazione interna) o a mano dal drawer ---
  | "da_chiamare" // appuntamento telefonico (next_action_at = quando)
  | "demo_richiesta" // "demo da fare": il lead ha detto sì, va preparata
  | "demo_inviata" // demo mandata, in attesa di risposta
  | "richiesta_prezzo" // ha chiesto quanto costa
  | "in_trattativa"
  | "tiepido" // ricontattare il next_action_at
  | "vinto"
  | "perso" // lost_reason = motivo
  | "escalation"
  | "archiviato";

/** Stati trattativa selezionabili dal drawer (bot sempre muto).
 *  Il triage automatico può assegnare: risposto_manuale (da
 *  rispondere), da_chiamare, demo_richiesta, richiesta_prezzo, perso. */
export const DEAL_STAGES: AutopilotStage[] = [
  "risposto_manuale",
  "da_chiamare",
  "demo_richiesta",
  "demo_inviata",
  "richiesta_prezzo",
  "in_trattativa",
  "tiepido",
  "vinto",
  "perso",
];

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
  /** ISO dell'unico messaggio di sblocco auto-reply (max 1 per lead). */
  bypass_sent_at: string | null;
  /** Link demo preparato da Puccio FUORI da SPECTRE e incollato in
   *  dashboard. Il worker lo invia (template demo_ready) e marca
   *  demo_sent_at: SPECTRE non builda nulla. */
  demo_url: string;
  demo_sent_at: string | null;
  /** Prossima azione manuale di Puccio (es. "chiamare lunedì 9:00"). */
  next_action: string;
  /** Quando va fatta (ISO locale da datetime-local): alimenta la vista
   *  Agenda e il promemoria WA mattutino del worker. */
  next_action_at: string | null;
  /** Motivo del perso (prezzo, non interessato, …). */
  lost_reason: string;
  /** Note libere trattativa (vive su leads.notes, condivisa col Visor). */
  notes: string;
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
  /** "1" = bot conversazionale legacy attivo; default OFF: il bot
   *  classifica soltanto (auto-reply / umana / opt-out) e tace. */
  bot_conversational: boolean;
  /** ISO dell'ultimo heartbeat del worker (ogni ~60s quando vivo). */
  worker_heartbeat: string | null;
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
  /** false = heartbeat assente o più vecchio di 3 minuti: il worker
   *  non sta girando, gli approvati restano in coda. */
  worker_online: boolean;
  worker_heartbeat: string | null;
}

/** Output Gemini per lo Stadio 1.5 (brief + primo messaggio). */
export interface StudyGeneration {
  brief: string;
  wa_message: string;
}
