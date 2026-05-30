// ============================================================
// AYRO SPECTRE — Core type definitions
// ============================================================

// 8-stage WhatsApp sales funnel (AYROMEX pitch process).
export type LeadStatus =
  | "todo"
  | "step1_sent"
  | "replied"
  | "step2_sent"
  | "preview_sent"
  | "negotiating"
  | "closed"
  | "lost";

/**
 * Structured business + funnel metadata, stored as a JSON text column on
 * `leads` (SQLite has no JSON type). Drives the pitch engine (message
 * generation, next-best-action, stale detection) and contact links.
 */
export interface LeadMeta {
  rating?: number;
  reviews?: number;
  address?: string;
  /** activity category: ristorante, barbiere, estetista, parrucchiere… */
  category?: string;
  ig?: string;
  fb?: string;
  maps_url?: string;
  // Funnel timestamps (ISO) — set when the lead enters each stage.
  step1_at?: string;
  replied_at?: string;
  step2_at?: string;
  preview_at?: string;
  closed_at?: string;
  // Outcome.
  closed_price?: number;
  lost_reason?: string;
  // Operator overrides for the generated WhatsApp messages.
  custom_step1?: string;
  custom_step2?: string;
  custom_step3?: string;
  /** Live preview URL pasted into the Step 3 delivery message. */
  preview_url?: string;
}

export type LeadSource = "maps" | "linkedin" | "referral" | "cold";

export type RelationType =
  | "colleague"
  | "competitor"
  | "friend"
  | "family"
  | "investor";

export type InteractionType =
  | "call"
  | "email"
  | "whatsapp"
  | "meeting"
  | "note";

export type Sentiment = "positive" | "neutral" | "negative";

export type ProposalStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "accepted"
  | "rejected";

export type AiModule = "whisper" | "hand" | "oracle";

export interface Lead {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  source: LeadSource;
  status: LeadStatus;
  value: number;
  probability: number;
  last_contact: string;
  next_action: string;
  notes: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  graph_connections: string[];
  meta: LeadMeta;
}

export interface Interaction {
  id: string;
  lead_id: string;
  type: InteractionType;
  content: string;
  sentiment: Sentiment;
  ai_summary: string;
  created_at: string;
}

export interface ProposalSection {
  heading: string;
  body: string;
}

export interface PricingTier {
  name: string;
  price: number;
  description: string;
}

export interface ProposalContent {
  title: string;
  sections: ProposalSection[];
  pricing: PricingTier[];
  email_subject: string;
  email_body: string;
  followup_script: string;
}

export interface Proposal {
  id: string;
  lead_id: string;
  title: string;
  content_json: ProposalContent;
  pdf_url: string | null;
  status: ProposalStatus;
  price_total: number;
  created_at: string;
}

export interface AiLog {
  id: string;
  module: AiModule;
  input: string;
  output: string;
  latency_ms: number;
  created_at: string;
}

export interface MindEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  strength: number;
  evidence: string;
}

// ----- AI response contracts ---------------------------------

export type ObjectionType =
  | "prezzo"
  | "tempistiche"
  | "concorrenza"
  | "autorita"
  | "bisogno"
  | "fiducia";

export type ResponseAngle = "value" | "urgency" | "social";

export interface WhisperResponse {
  detected_objection: ObjectionType | null;
  confidence: number;
  responses: {
    type: ResponseAngle;
    text: string;
    rationale: string;
  }[];
}

export interface OracleScenario {
  label: string;
  probability: number;
  change: number;
}

export interface OraclePrediction {
  probability_main: number;
  confidence: number;
  scenarios: OracleScenario[];
  insight: string;
  recommendation: string;
  urgency_level: "low" | "medium" | "high";
}

// ----- API envelope ------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
}
