import type { AutopilotStage } from "@/types/autopilot";

// ============================================================
// Pipeline — configurazione e prompt Gemini.
// Stack lock: Gemini Flash only fino a 200 clienti.
// ============================================================

/** Colonne della Pipeline, in ordine (kanban + conteggi). */
export const AUTOPILOT_STAGES: AutopilotStage[] = [
  "da_contattare",
  "contattato",
  "ha_risposto",
  "in_trattativa",
  "vinto",
  "perso",
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

// ----- Prompt Gemini -----------------------------------------

/** Prompt Study: genera SOLO il lead brief commerciale. Il primo messaggio
 *  WhatsApp non passa più da Gemini: è una delle tre varianti deterministiche
 *  A/B/C (lib/autopilot/variants.ts), col complimento costruito dai dati reali
 *  del lead. Il template "study_wa_instructions" non è più letto da Study. */
export function buildStudyPrompt(): string {
  return `Sei l'analista commerciale di AYROMEX, web agency di Bari che vende siti vetrina a PMI locali pugliesi.
Ricevi i dati di un'attività locale SENZA sito web (recensioni Google recenti, presenza digitale, categoria, zona).

Devi produrre JSON con un campo:

1. "brief": lead brief di MASSIMO 5 righe per il commerciale. Contiene: cosa fa l'attività, cosa amano i clienti (dalle recensioni vere), presenza digitale attuale, il gap principale senza sito (prenotazioni dirette vs commissioni piattaforme, ricerca Google locale, vetrina servizi/menu/prezzi), angolo di attacco consigliato.

REGOLA DATI: se "rating" o "recensioni_totali" sono null, il dato NON è disponibile: non citarlo e non inventare numeri (mai "0 su Google" o "0 recensioni").

Rispondi SOLO con JSON: {"brief": "..."}`;
}

// Triage e risposta suggerita (copilota manuale) vivono in
// lib/autopilot/prompts.ts. Le istruzioni del primo messaggio WA
// arrivano dal template manager (message_templates, /templates).
