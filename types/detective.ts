// ============================================================
// SPECTER DETECTIVE — Audit Light Engine, type definitions.
// Dossier "dove stai perdendo soldi" da sole fonti pubbliche,
// per prospect CON sito web (verticale saloni/estetica).
// ============================================================

/** Funnel dedicato Detective — separato dal funnel web agency. */
export type DetectiveStatus =
  | "scouted"
  | "investigated"
  | "report_ready"
  | "sent"
  | "interested"
  | "pilot"
  | "archived";

// ----- investigate: raccolta fonti pubbliche ------------------

export interface WebsiteAudit {
  url: string;
  fetched: boolean;
  http_status?: number;
  response_ms?: number;
  html_kb?: number;
  has_contact_form: boolean;
  has_booking: boolean;
  /** treatwell / fresha / booksy / planity / calendly / nativo… */
  booking_provider?: string;
  has_wa_chat: boolean;
  has_tel_link: boolean;
  has_hours: boolean;
  has_pricing: boolean;
  has_viewport_meta: boolean;
  title?: string;
  instagram_url?: string;
  facebook_url?: string;
  /** Punteggio PageSpeed 0-100, solo se la PSI API è disponibile. */
  psi_performance?: number;
}

export interface GbpReview {
  rating: number;
  text: string;
  when: string;
}

export interface GbpAudit {
  fetched: boolean;
  rating?: number;
  reviews_count?: number;
  maps_uri?: string;
  /** Max 5 recensioni recenti (limite Places API New). */
  recent_reviews: GbpReview[];
  /** Booking link esposto sulla scheda (campo Places se presente). */
  gbp_booking_uri?: string;
}

export interface SocialAudit {
  instagram?: {
    url: string;
    fetched: boolean;
    followers?: number;
    posts?: number;
  };
  facebook?: { url: string; fetched: boolean };
}

/** Tutto ciò che l'indagine ha realmente raccolto (fonti pubbliche). */
export interface DetectiveRawData {
  website: WebsiteAudit | null;
  gbp: GbpAudit | null;
  social: SocialAudit;
  collected_at: string;
  /** Fatti verificabili F1..Fn derivati deterministicamente dai dati:
   *  l'unica base ammessa per le perdite (anti-hallucination). */
  facts: DetectiveFact[];
}

export interface DetectiveFact {
  id: string; // F1, F2…
  text: string;
}

// ----- analyze: output Gemini (validato) ----------------------

export interface DetectiveScores {
  visibilita: number;
  reattivita: number;
  recupero_clienti: number;
  reputazione: number;
  prenotabilita: number;
}

export interface DetectiveLoss {
  title: string;
  /** Evidenza concreta, costruita SOLO sui fact id citati. */
  evidence: string;
  fact_ids: string[];
  /** Automazione del catalogo (solo nome + beneficio, NO prezzi). */
  automation: { name: string; benefit: string };
  monthly_min: number;
  monthly_max: number;
}

export interface DetectiveAnalysis {
  scores: DetectiveScores;
  /** Media dei 5 score, calcolata in codice. */
  overall: number;
  losses: DetectiveLoss[]; // max 7
  total_min: number; // somma min, calcolata in codice
  total_max: number;
  assumptions: string[];
  /** Messaggio WA per Puccio: aggancio = 1 perdita concreta + link report. */
  wa_message: string;
}

// ----- caso ----------------------------------------------------

export interface DetectiveCase {
  id: string;
  place_id: string;
  business_name: string;
  website_url: string;
  phone: string;
  city: string;
  category: string;
  raw_data: DetectiveRawData | null;
  scores: DetectiveScores | null;
  losses: DetectiveLoss[];
  analysis: DetectiveAnalysis | null;
  report_slug: string;
  status: DetectiveStatus;
  wa_message: string;
  error: string;
  created_at: string;
  updated_at: string;
}
