// ============================================================
// AYRO SPECTRE — Voice system types
// ============================================================

export type VoiceStatus =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "muted";

export type VoiceCommandType =
  | "navigate"
  | "action"
  | "search"
  | "filter"
  | "hunt"
  | "generate"
  | "simulate"
  | "read"
  | "browser"
  | "control"
  | "help"
  | "wake"
  | "unknown";

export interface VoiceCommand {
  type: VoiceCommandType;
  payload: Record<string, unknown>;
  /** What SPECTRE says back (empty = stay silent). */
  responseText: string;
}

export interface TTSOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}

export type VoiceModule =
  | "pipeline"
  | "visor" // storico: nessun listener, Visor è confluito in Pipeline
  | "hunter"
  | "hand"
  | "oracle" // storico: nessun listener, Oracle è confluito in Pipeline
  | "whisper" // storico: nessun listener, funzione rimossa
  | "mind";

/** Cross-component command bus: the hook publishes, a module consumes. */
export interface VoicePendingAction {
  module: VoiceModule;
  kind: string;
  payload: Record<string, unknown>;
  /** Monotonic id so the same command repeated still re-fires. */
  nonce: number;
}

/** A page registers readable content so "leggi ..." can speak it. */
export interface VoiceReadable {
  section: string;
  text: string;
}

// ----- AYRO conversational agent (Gemini) -----

export type AyroActionType =
  | "navigate"
  | "hunt"
  | "search"
  | "filter"
  | "generate"
  | "simulate"
  | "none";

export interface AyroAction {
  type: AyroActionType;
  payload?: Record<string, unknown>;
}

/** Gemini's reply when a free-form request isn't a fixed command. */
export interface AyroResponse {
  /** What SPECTRE says back (spoken, Italian, concise). */
  speak: string;
  /** Optional action to perform after speaking. */
  action?: AyroAction;
}
