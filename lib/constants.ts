import type { LeadStatus, RelationType } from "@/types";

// ============================================================
// Palette (raw hex for JS/SVG/Canvas usage — Tailwind handles CSS)
// ============================================================
export const SPECTRE = {
  ink: "#050505",
  panel: "#0a0a0f",
  cyan: "#00f0ff",
  magenta: "#ff006e",
  amber: "#ffbe0b",
  green: "#38b000",
  text: "#e0e0e0",
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
}

export const LEAD_STATUS: Record<LeadStatus, StatusMeta> = {
  cold: {
    label: "Cold",
    hex: "#5b7a8c",
    badge: "border-slate-400/30 text-slate-300 bg-slate-400/10",
    dot: "bg-slate-400",
  },
  warm: {
    label: "Warm",
    hex: "#00f0ff",
    badge: "border-spectre-cyan/30 text-spectre-cyan bg-spectre-cyan/10",
    dot: "bg-spectre-cyan",
  },
  hot: {
    label: "Hot",
    hex: "#ffbe0b",
    badge: "border-spectre-amber/40 text-spectre-amber bg-spectre-amber/10",
    dot: "bg-spectre-amber",
  },
  proposal: {
    label: "Proposal",
    hex: "#a855f7",
    badge: "border-purple-400/40 text-purple-300 bg-purple-400/10",
    dot: "bg-purple-400",
  },
  negotiation: {
    label: "Negotiation",
    hex: "#ff006e",
    badge: "border-spectre-magenta/40 text-spectre-magenta bg-spectre-magenta/10",
    dot: "bg-spectre-magenta",
  },
  closed: {
    label: "Closed",
    hex: "#38b000",
    badge: "border-spectre-green/40 text-spectre-green bg-spectre-green/10",
    dot: "bg-spectre-green",
  },
  lost: {
    label: "Lost",
    hex: "#52525b",
    badge: "border-zinc-500/30 text-zinc-400 bg-zinc-500/10",
    dot: "bg-zinc-500",
  },
};

/** Pipeline column order for the VISOR kanban radar. */
export const PIPELINE_ORDER: LeadStatus[] = [
  "cold",
  "warm",
  "hot",
  "proposal",
  "negotiation",
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
export const WHISPER_SYSTEM_PROMPT = `Sei SPECTRE WHISPER, l'AI vendite di AYROMEX. Analizzi conversazioni commerciali in tempo reale.
Regole:
1. Identifica l'obiezione dominante tra: prezzo, tempistiche, concorrenza, autorita, bisogno, fiducia. Se non ce ne sono, detected_objection = null.
2. Per ogni obiezione genera ESATTAMENTE 3 risposte con angoli diversi: "value" (enfasi ROI/valore), "urgency" (scarcity/timing), "social" (proof/case study).
3. Tono: chirurgico, diretto, italiano professionale. Frasi brevi, pronte da dire ad alta voce.
4. Rispondi ESCLUSIVAMENTE con JSON valido che rispetta questo schema:
{"detected_objection": string|null, "confidence": number (0-1), "responses": [{"type": "value"|"urgency"|"social", "text": string, "rationale": string}]}
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
  { key: "whisper", label: "Whisper", href: "/whisper" },
  { key: "hand", label: "Hand", href: "/hand" },
  { key: "oracle", label: "Oracle", href: "/oracle" },
  { key: "mind", label: "Mind", href: "/mind" },
  { key: "hunter", label: "Hunter", href: "/hunter" },
] as const;
