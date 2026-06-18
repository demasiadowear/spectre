import type { AutopilotStage, AutopilotTier } from "@/types/autopilot";

// ============================================================
// Autopilot — configurazione di pipeline e prompt Gemini.
// Stack lock: Gemini Flash only fino a 200 clienti.
// ============================================================

export const AUTOPILOT_STAGES: AutopilotStage[] = [
  "nuovo",
  "studiato",
  "contattato",
  "risposto_manuale",
  "da_chiamare",
  "demo_richiesta",
  "demo_inviata",
  "richiesta_prezzo",
  "in_trattativa",
  "tiepido",
  "vinto",
  "perso",
  "escalation",
  "archiviato",
];

// ----- Stadio 1 — SCOUT --------------------------------------

/** Categorie target (query Places in italiano). */
export const SCOUT_CATEGORIES = [
  "parrucchiere",
  "ristorante",
  "lido balneare",
  "centro estetico",
  "enoteca",
] as const;

/** Zona Bari/Modugno/provincia. Ruotate giorno per giorno per non
 *  bruciare quota Places in una singola run. */
export const SCOUT_LOCATIONS = [
  "Bari",
  "Modugno",
  "Bitonto",
  "Molfetta",
  "Monopoli",
  "Polignano a Mare",
  "Altamura",
  "Triggiano",
  "Bitetto",
  "Giovinazzo",
] as const;

/** Quante combinazioni categoria×località per run giornaliera. */
export const SCOUT_QUERIES_PER_RUN = 5;

/** Filtro base: rating >=4.5, 30+ recensioni, SENZA sito proprio. */
export const SCOUT_MIN_RATING = 4.5;
export const SCOUT_MIN_REVIEWS = 30;

/** Tier scoring: T1 >=4.8/100+ rec, T2 >=4.6/50+, T3 >=4.5/30+. */
export function scoreTier(rating: number, reviews: number): AutopilotTier {
  if (rating >= 4.8 && reviews >= 100) return "T1";
  if (rating >= 4.6 && reviews >= 50) return "T2";
  return "T3";
}

/** Valore stimato per tier (per il campo value del lead). */
export const TIER_VALUE: Record<AutopilotTier, number> = {
  T1: 980,
  T2: 700,
  T3: 499,
};

// ----- Prompt Gemini -----------------------------------------

/** Prompt Study. Le istruzioni del primo messaggio WA (variante A:
 *  stelle+demo) NON vivono qui: arrivano dal template manager
 *  (message_templates, key "study_wa_instructions") e si modificano
 *  da /templates senza deploy. */
export function buildStudyPrompt(waInstructions: string): string {
  return `Sei l'analista commerciale di AYROMEX, web agency di Bari che vende siti vetrina a PMI locali pugliesi.
Ricevi i dati di un'attività locale SENZA sito web (recensioni Google recenti, presenza digitale, categoria, zona).

Devi produrre JSON con due campi:

1. "brief": lead brief di MASSIMO 5 righe per il commerciale. Contiene: cosa fa l'attività, cosa amano i clienti (dalle recensioni vere), presenza digitale attuale, il gap principale senza sito (prenotazioni dirette vs commissioni piattaforme, ricerca Google locale, vetrina servizi/menu/prezzi), angolo di attacco consigliato.

2. "wa_message": il PRIMO messaggio WhatsApp. ${waInstructions}

Rispondi SOLO con JSON: {"brief": "...", "wa_message": "..."}`;
}

// Triage e risposta suggerita (copilota manuale) vivono in
// lib/autopilot/prompts.ts. Le istruzioni del primo messaggio WA
// arrivano dal template manager (message_templates, /templates).
