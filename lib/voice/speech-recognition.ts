// ============================================================
// Web Speech API wrapper (it-IT). Typed locally with SR* names so
// there's no clash with any lib.dom declarations. Browser-only:
// getCtor() returns null on the server / unsupported browsers, and
// the UI falls back to a text input.
// ============================================================

export interface SRAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
export interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SRAlternative;
}
export interface SRResultList {
  readonly length: number;
  readonly [index: number]: SRResult;
}
export interface SREvent {
  readonly resultIndex: number;
  readonly results: SRResultList;
}
export interface SRErrorEvent {
  readonly error: string;
  readonly message: string;
}
export interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SRConstructor = new () => SRInstance;

function getCtor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getCtor() !== null;
}

export function createSpeechRecognition(): SRInstance | null {
  const Ctor = getCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "it-IT";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  return rec;
}
