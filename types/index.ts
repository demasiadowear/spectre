// ============================================================
// AYRO SPECTRE — Core type definitions
// ============================================================

export type LeadStatus =
  | "cold"
  | "warm"
  | "hot"
  | "proposal"
  | "negotiation"
  | "closed"
  | "lost";

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
