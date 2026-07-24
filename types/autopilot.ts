// ============================================================
// AYRO SPECTRE — Pipeline types
// Macchina a stati UNICA della Pipeline (ex Visor + Autopilot fusi):
//   da_contattare -> contattato -> ha_risposto -> in_trattativa ->
//   vinto / perso   (+ archiviato come bidone laterale)
// Sorgente unica: autopilot_pipeline.stage. leads.status è storico.
// Il dettaglio fine (demo da fare, richiamo, prezzo) vive in next_action.
// ============================================================

/** Stati della Pipeline — sequenza unica dal contatto alla chiusura. */
export type AutopilotStage =
  | "da_contattare" // lead pronto (o da preparare): primo messaggio non ancora inviato
  | "contattato" // primo messaggio inviato, in attesa di risposta
  | "ha_risposto" // il cliente ha risposto, da gestire
  | "in_trattativa" // trattativa attiva (demo, richiamo, prezzo… nel next_action)
  | "vinto"
  | "perso" // lost_reason = motivo
  | "archiviato"; // fuori pipeline (numero fisso, opt-out, scartato)

/** Stati selezionabili a mano dal drawer. "archiviato" no: si usa il
 *  pulsante Archivia dedicato (che imposta anche archived_reason). */
export const DEAL_STAGES: AutopilotStage[] = [
  "da_contattare",
  "contattato",
  "ha_risposto",
  "in_trattativa",
  "vinto",
  "perso",
];

/** Stato del primo messaggio WA (storico: sempre "auto" nel flusso attuale). */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "auto";

/** Variante del primo messaggio WA per l'A/B test. Scelta in modo
 *  deterministico da hash(lead_id) % 3 in Study, così lo stesso lead
 *  riceve sempre la stessa variante anche se ricomposto. */
export type WaVariant = "A" | "B" | "C";

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

/** Riga pipeline joinata con il lead (vista dashboard). */
export interface AutopilotLead {
  lead_id: string;
  stage: AutopilotStage;
  place_id: string;
  category: string;
  city: string;
  brief: string;
  study: AutopilotStudy | null;
  wa_first_message: string;
  /** Variante A/B/C usata per wa_first_message (vuota se non ancora
   *  studiato). Persistita su autopilot_pipeline.wa_variant per misurare
   *  il tasso di risposta per variante. */
  wa_variant: WaVariant | "";
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
  /** Link demo preparato da Puccio FUORI da SPECTRE, incollato in
   *  dashboard e mandato a mano su WhatsApp. SPECTRE non builda nulla. */
  demo_url: string;
  demo_sent_at: string | null;
  /** Prossima azione manuale di Puccio (es. "chiamare lunedì 9:00"). */
  next_action: string;
  /** Quando va fatta (ISO locale da datetime-local): alimenta la vista
   *  Agenda della dashboard. */
  next_action_at: string | null;
  /** Motivo del perso (prezzo, non interessato, …). */
  lost_reason: string;
  /** Note libere trattativa (vive su leads.notes, condivisa col Visor). */
  notes: string;
  created_at: string;
  updated_at: string;
  /** Prezzo deciso a mano da Puccio (€). null = nessun prezzo (default).
   *  Niente prezzo automatico dal sistema. Vive in leads.meta.price. */
  price: number | null;
  // Dal lead collegato.
  name: string;
  company: string;
  phone: string;
  /** Qualità lead = stelle Google + n. recensioni (NON è un tier, NON
   *  c'entra col prezzo). Serve solo a sapere chi contattare prima. */
  rating: number;
  reviews: number;
  address: string;
  /** Handle Instagram (da leads.meta.ig). "" se sconosciuto: Scout non lo
   *  popola, arriva solo dagli import beauty. Mai usato per inventare dati. */
  ig: string;
  /** Tipo numero: "mobile" = WhatsApp-abile, "fisso" = solo chiamata. */
  phone_type: "mobile" | "fisso" | "";
  /** Coordinate per la vista Mappa (da leads.meta.lat/lng). */
  lat: number | null;
  lng: number | null;
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

export interface AutopilotStats {
  by_stage: Record<AutopilotStage, number>;
  unread_alerts: number;
}

/** Output Gemini per lo Stadio 1.5 (brief + primo messaggio). */
export interface StudyGeneration {
  brief: string;
  wa_message: string;
}
