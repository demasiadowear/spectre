import type { LeadStatus, RelationType } from "@/types";

// ============================================================
// Palette (raw hex for JS/SVG/Canvas usage — Tailwind handles CSS)
// ============================================================
// Earth palette for JS-driven colours (map pins, bars, gauges). Static
// mid-tones that read on both light and dark surfaces.
export const SPECTRE = {
  ink: "#3A3327",
  panel: "#FCFAF5",
  cyan: "#C2410C", // accent terracotta
  magenta: "#B0492B", // brick
  amber: "#B07D2B", // ochre
  green: "#5C7A5C", // salvia
  text: "#3A3327",
} as const;

// ============================================================
// Lead status config
// ============================================================
export interface StatusMeta {
  label: string;
  hex: string;
  /** Tailwind classes for badge surfaces. */
  badge: string;
  dot: string;
  /** Left-border colour class (status family) for cards. */
  leftBorder: string;
  /** Column-header underline colour class. */
  headerAccent: string;
}

export const LEAD_STATUS: Record<LeadStatus, StatusMeta> = {
  todo: {
    label: "Da contattare",
    hex: "#8A877E",
    badge: "border-fn-todo/45 text-fn-todo bg-fn-todo/12",
    dot: "bg-fn-todo",
    leftBorder: "border-l-fn-todo",
    headerAccent: "border-fn-todo",
  },
  step1_sent: {
    label: "1° contatto",
    hex: "#9A7B1E",
    badge: "border-fn-step1/45 text-fn-step1 bg-fn-step1/12",
    dot: "bg-fn-step1",
    leftBorder: "border-l-fn-step1",
    headerAccent: "border-fn-step1",
  },
  replied: {
    label: "Ha risposto",
    hex: "#1D6E8C",
    badge: "border-fn-replied/45 text-fn-replied bg-fn-replied/12",
    dot: "bg-fn-replied",
    leftBorder: "border-l-fn-replied",
    headerAccent: "border-fn-replied",
  },
  step2_sent: {
    label: "2° contatto",
    hex: "#C58A1A",
    badge: "border-fn-step2/45 text-fn-step2 bg-fn-step2/12",
    dot: "bg-fn-step2",
    leftBorder: "border-l-fn-step2",
    headerAccent: "border-fn-step2",
  },
  preview_sent: {
    label: "Anteprima",
    hex: "#7A4F9E",
    badge: "border-fn-preview/45 text-fn-preview bg-fn-preview/12",
    dot: "bg-fn-preview",
    leftBorder: "border-l-fn-preview",
    headerAccent: "border-fn-preview",
  },
  negotiating: {
    label: "In trattativa",
    hex: "#A8431E",
    badge: "border-fn-negotiating/45 text-fn-negotiating bg-fn-negotiating/12",
    dot: "bg-fn-negotiating",
    leftBorder: "border-l-fn-negotiating",
    headerAccent: "border-fn-negotiating",
  },
  closed: {
    label: "Chiuso",
    hex: "#3B6B34",
    badge: "border-fn-closed/45 text-fn-closed bg-fn-closed/12",
    dot: "bg-fn-closed",
    leftBorder: "border-l-fn-closed",
    headerAccent: "border-fn-closed",
  },
  lost: {
    label: "Perso",
    hex: "#9A6B5E",
    badge: "border-fn-lost/40 text-fn-lost bg-fn-lost/10",
    dot: "bg-fn-lost",
    leftBorder: "border-l-fn-lost",
    headerAccent: "border-fn-lost",
  },
};

/**
 * Card container classes per status: left-border 4px in the status colour;
 * "negotiating" gets a full rust fill (white text handled by callers via
 * `statusIsFill`); "lost" is dimmed.
 */
/**
 * Status meta lookup tolerant to unknown/legacy values. Seed data and
 * older imports can carry statuses outside the 8-stage funnel (es.
 * "warm"/"cold"/"proposal"): senza guardia un solo lead così manda in
 * crash l'intero board (LEAD_STATUS[status] undefined). Qui degrada a
 * una meta neutra e mostra il valore grezzo come label.
 */
export function statusMeta(status: string): StatusMeta {
  return (
    LEAD_STATUS[status as LeadStatus] ?? {
      ...LEAD_STATUS.todo,
      label: status ? status.toUpperCase() : "—",
    }
  );
}

export function statusCardClass(status: LeadStatus): string {
  if (status === "negotiating")
    return "border border-fn-negotiating bg-fn-negotiating";
  const dim = status === "lost" ? " opacity-[0.78]" : "";
  return `border border-border border-l-[4px] ${statusMeta(status).leftBorder} bg-surface${dim}`;
}

export function statusIsFill(status: LeadStatus): boolean {
  return status === "negotiating";
}

/** Compact column header label for the VISOR kanban (canale-agnostiche). */
export const STATUS_SHORT: Record<LeadStatus, string> = {
  todo: "Da contattare",
  step1_sent: "1° contatto",
  replied: "Ha risposto",
  step2_sent: "2° contatto",
  preview_sent: "Anteprima",
  negotiating: "In trattativa",
  closed: "Chiusi",
  lost: "Persi",
};

/** Pipeline column order for the VISOR kanban radar (lost shown apart). */
export const PIPELINE_ORDER: LeadStatus[] = [
  "todo",
  "step1_sent",
  "replied",
  "step2_sent",
  "preview_sent",
  "negotiating",
  "closed",
];

export const RELATION_META: Record<RelationType, { label: string; hex: string }> =
  {
    colleague: { label: "Collega", hex: "#00f0ff" },
    competitor: { label: "Competitor", hex: "#ff006e" },
    friend: { label: "Conoscente", hex: "#38b000" },
    family: { label: "Famiglia", hex: "#ffbe0b" },
    investor: { label: "Investitore", hex: "#a855f7" },
  };

// ============================================================
// Probability → color band (for badges / Oracle big number)
// ============================================================
export function probabilityHex(p: number): string {
  if (p >= 70) return SPECTRE.green;
  if (p >= 40) return SPECTRE.amber;
  return SPECTRE.magenta;
}

export function probabilityBadge(p: number): string {
  if (p >= 70)
    return "border-spectre-green/40 text-spectre-green bg-spectre-green/10";
  if (p >= 40)
    return "border-spectre-amber/40 text-spectre-amber bg-spectre-amber/10";
  return "border-spectre-magenta/40 text-spectre-magenta bg-spectre-magenta/10";
}

// ============================================================
// AI system prompts (Claude)
// ============================================================
export const WHISPER_SYSTEM_PROMPT = `Sei SPECTRE WHISPER, l'AI vendite di AYROMEX. Ascolti la trascrizione di una conversazione commerciale reale e suggerisci all'operatore cosa rispondere.
Regole:
1. Identifica l'obiezione dominante tra: prezzo, tempistiche, concorrenza, autorita, bisogno, fiducia. Se non ce ne sono, detected_objection = null.
2. Deduci il TONO EMOTIVO del cliente dalle sue parole (client_tone): uno tra "freddo","scettico","interessato","irritato","esitante","entusiasta","neutro". In tone_note scrivi UNA riga su come si sente e come gestirlo (es. "Scettico per esperienze passate: rassicura con prova sui suoi numeri").
3. Genera ESATTAMENTE 3 risposte con angoli diversi: "value" (ROI/valore), "urgency" (scarcity/timing), "social" (proof/case study). Le risposte DEVONO essere coerenti col tono rilevato (se è irritato, abbassa la pressione; se è entusiasta, spingi alla chiusura).
4. Tono di scrittura: chirurgico, diretto, italiano parlato. Frasi brevi, pronte da dire ad alta voce.
5. Rispondi ESCLUSIVAMENTE con JSON valido:
{"detected_objection": string|null, "confidence": number (0-1), "client_tone": string, "tone_note": string, "responses": [{"type": "value"|"urgency"|"social", "text": string, "rationale": string}]}
Niente testo fuori dal JSON.`;

export const HAND_SYSTEM_PROMPT = `Sei SPECTRE HAND, l'AI proposte di AYROMEX (AI Automation Agency, Italia). Generi proposte commerciali in italiano.
Struttura obbligatoria:
- Titolo personalizzato col nome azienda
- Hook: problema specifico del settore del lead
- Diagnosi: 2-3 bullet del pain point
- Soluzione: servizi AYROMEX pertinenti (automazioni AI, AyroDesk24, AyroHub, lead gen)
- Proof: 1 caso studio breve e credibile
- Pricing: 3 livelli (Starter / Pro / Enterprise) con prezzi in euro coerenti col valore del deal
- Email di accompagnamento (oggetto + corpo)
- Script vocale breve per follow-up telefonico
Tono: professionale ma diretto. Rispondi ESCLUSIVAMENTE con JSON valido:
{"proposal": {"title": string, "sections": [{"heading": string, "body": string}], "pricing": [{"name": string, "price": number, "description": string}], "email_subject": string, "email_body": string, "followup_script": string}}
Niente testo fuori dal JSON.`;

export const ORACLE_SYSTEM_PROMPT = `Sei SPECTRE ORACLE, il predittore di chiusura di AYRO SPECTRE. Calcoli la probabilita di chiusura di un deal.
Fattori da pesare: valore del deal, giorni dal primo contatto, numero di interazioni, settore, bundle inclusi, stagionalita, prezzo proposto vs valore.
Genera 3 scenari comparativi (es. attuale, prezzo -10%, bundle incluso) con probabilita e delta rispetto allo scenario attuale.
Rispondi ESCLUSIVAMENTE con JSON valido:
{"probability_main": number (0-100), "confidence": number (0-1), "scenarios": [{"label": string, "probability": number, "change": number}], "insight": string, "recommendation": string, "urgency_level": "low"|"medium"|"high"}
Niente testo fuori dal JSON.`;

// ============================================================
// Voice system
// ============================================================
export const ELEVENLABS_DEFAULT_VOICE = "Francesco";
export const ELEVENLABS_MODEL = "eleven_multilingual_v2";
export const VOICE_WAKE_WORDS = [
  "ciao spectre",
  "hey spectre",
  "ok spectre",
  "spectre",
];

export const SPECTRE_MODULES = [
  { key: "visor", label: "Visor", href: "/visor" },
  { key: "cockpit", label: "Cockpit", href: "/cockpit" },
  { key: "whisper", label: "Whisper", href: "/whisper" },
  { key: "hand", label: "Hand", href: "/hand" },
  { key: "oracle", label: "Oracle", href: "/oracle" },
  { key: "territorio", label: "Territorio", href: "/territorio" },
  { key: "forecast", label: "Forecast", href: "/forecast" },
  { key: "hunter", label: "Hunter", href: "/hunter" },
] as const;
