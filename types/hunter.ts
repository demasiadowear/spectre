// ============================================================
// AYRO SPECTRE — Lead Hunter types
// ============================================================

import type { AsteLot } from "@/types/intent";

export type HunterPriority = "HOT" | "WARM" | "COLD";

/** Sorgente della ricerca Hunter. */
export type HunterSource = "google" | "aste";

/** A business as returned by Google Places or the mock source. */
export interface RawLead {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string;
  rating: number;
  reviews: number;
  has_website: boolean;
  website: string | null;
  lat?: number;
  lng?: number;
}

/** A RawLead enriched with SPECTRE's close-probability scoring. */
export interface ScoredLead extends RawLead {
  hunter_score: number;
  priority: HunterPriority;
}

export interface HunterParams {
  location: string;
  category: string;
  radius?: number;
  min_rating?: number;
  limit?: number;
  only_no_website?: boolean;
  /** Sorgente: "google" (default) o "aste" (aste giudiziarie Bari). */
  source?: HunterSource;
}

export interface HuntResult {
  leads: ScoredLead[];
  count: number;
  source: "google-places" | "mock" | "aste";
  /** Lotti aste (valorizzato solo quando source = "aste"). */
  aste_lots?: AsteLot[];
}

export interface ScriptObjection {
  objection: string;
  response: string;
}

/** Structured cold-call script (Claude or mock). */
export interface ColdCallScript {
  opening: string;
  rapport: string;
  pain_points: string[];
  solution: string;
  social_proof: string;
  price_anchor: string;
  closing: string;
  objections: ScriptObjection[];
}

export interface HunterCategoryOption {
  /** Query term sent to Google Maps. */
  value: string;
  label: string;
}

export const HUNTER_CATEGORIES: HunterCategoryOption[] = [
  { value: "parrucchiere", label: "Parrucchiere" },
  { value: "barbiere", label: "Barbiere" },
  { value: "estetista", label: "Estetista" },
  { value: "tattoo studio", label: "Tattoo Studio" },
  { value: "palestra", label: "Palestra" },
  { value: "ristorante", label: "Ristorante" },
  { value: "pizzeria", label: "Pizzeria" },
  { value: "bar", label: "Bar" },
  { value: "dentista", label: "Dentista" },
  { value: "avvocato", label: "Avvocato" },
  { value: "commercialista", label: "Commercialista" },
];
