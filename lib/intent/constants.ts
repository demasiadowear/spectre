import type { IntentStage } from "@/types/intent";

// ============================================================
// Intent Scout — configurazione.
// Fonti v1: AddLance + Freelanceboard (liste pubbliche senza login).
// Escluse (verifica 04/07/2026): ProntoPro (richieste visibili solo
// ai professionisti registrati, contatti a pagamento), Sevedemo
// (nessuna lista progetti pubblica), Subito.it (anti-bot DataDome).
// ============================================================

/** Colonne del kanban intent, in ordine. */
export const INTENT_STAGES: IntentStage[] = [
  "intent_found",
  "contacted",
  "meeting",
  "won",
  "lost",
];

export const INTENT_STAGE_LABELS: Record<IntentStage, string> = {
  intent_found: "Trovato",
  contacted: "Contattato",
  meeting: "Meeting",
  won: "Vinto",
  lost: "Perso",
};

/** Keyword che qualificano una richiesta come "sito web / servizi
 *  digitali". Match word-boundary case-insensitive su titolo+testo. */
export const INTENT_KEYWORDS = [
  "sito",
  "sito web",
  "sito internet",
  "sito vetrina",
  "siti web",
  "piattaforma web",
  "piattaforma digitale",
  "applicazione web",
  "website",
  "web design",
  "webdesign",
  "web designer",
  "webmaster",
  "wordpress",
  "shopify",
  "woocommerce",
  "e-commerce",
  "ecommerce",
  "landing page",
  "web app",
  "portale web",
  "restyling sito",
  "realizzazione sito",
  "sviluppo web",
  "sviluppatore web",
  "seo",
  "presenza online",
  "presenza digitale",
  "digitalizzazione",
] as const;

/** Zone che danno bonus di scoring (Puglia e province). */
export const INTENT_PUGLIA_ZONES = [
  "puglia",
  "bari",
  "modugno",
  "bitonto",
  "molfetta",
  "monopoli",
  "polignano",
  "altamura",
  "giovinazzo",
  "triggiano",
  "bitetto",
  "barletta",
  "andria",
  "trani",
  "taranto",
  "lecce",
  "brindisi",
  "foggia",
  "salento",
] as const;

// ----- Scoring (0-100) ---------------------------------------
// Freschezza è il segnale principale: una richiesta pubblicata da
// poche ore va contattata entro 1 ora dalla notifica.
export const INTENT_SCORE_BASE = 10;
export const INTENT_SCORE_FRESH_24H = 50;
export const INTENT_SCORE_FRESH_48H = 30;
export const INTENT_SCORE_FRESH_7D = 15;
export const INTENT_SCORE_PUGLIA_BONUS = 25;
export const INTENT_SCORE_BUDGET_BONUS = 15;

/** Soglia notifica immediata Telegram: con questi pesi solo le
 *  richieste <24h (50+10=60) arrivano a soglia anche senza bonus. */
export const INTENT_NOTIFY_MIN_SCORE = 60;

// ----- Prompt Gemini — gancio di apertura ---------------------

export function buildHookPrompt(): string {
  return `Sei il commerciale di AYROMEX, web agency di Bari (portfolio: ayromex.com — siti editoriali e immersivi per PMI, ristoranti, saloni, studi professionali).
Un'azienda ha PUBBLICATO una richiesta pubblica per un sito web / servizio digitale su una piattaforma freelance. Ricevi titolo, testo, zona e budget della richiesta.

Scrivi il GANCIO DI APERTURA per candidarti: 2-3 righe, tono diretto e concreto, zero formule da call center.
Regole:
- aggancia UN dettaglio specifico della richiesta (settore, esigenza, città), non frasi generiche
- una frase su cosa AYROMEX ha già fatto di simile, con rimando al portfolio ayromex.com
- chiudi con una proposta di contatto semplice (call di 10 minuti o esempio concreto)
- niente prezzi, niente "salve, siamo un'azienda leader", niente elenchi puntati

Rispondi SOLO con JSON: {"hook": "..."}`;
}
