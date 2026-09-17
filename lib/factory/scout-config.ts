// ============================================================
// Configurazione della qualificazione Scout e dei tetti di costo.
//
// Prima di questa fase lo Scout prendeva SOLO le attività senza sito
// (`lib/autopilot/scout.ts`, regola del 2026). Ora la modalità è
// configurabile, ma il comportamento storico resta raggiungibile con
// `no_site` e nulla cambia per chi non tocca niente nella sostanza:
// `both` aggiunge i siti deboli, non rimuove i lead senza sito.
//
// I tetti stanno qui e non sparsi nel codice perché sono decisioni
// COMMERCIALI, non tecniche: chi li cambia deve poterli leggere tutti
// in una schermata e capire quanto può spendere in un giorno.
// ============================================================

/** Chi entra in Factory. */
export type ScoutMode = "no_site" | "weak_site" | "both";

export const SCOUT_MODES: ScoutMode[] = ["no_site", "weak_site", "both"];

export interface FactoryLimits {
  /** Quali attività qualificare. */
  mode: ScoutMode;
  /** Siti analizzati al giorno: ogni analisi è una richiesta HTTP. */
  maxSiteAudits: number;
  /** Demo generate al giorno: è la voce che costa di più. */
  maxDemosPerDay: number;
  /** Tentativi per lead prima di lasciarlo stare. */
  maxAttemptsPerLead: number;
  /** Analisi in parallelo: tenuta bassa per non sembrare un attacco. */
  concurrency: number;
  /** Timeout per singola richiesta. */
  timeoutMs: number;
  /** Punteggio minimo per generare una demo. */
  minOpportunityScore: number;
  /** Giorni prima di rianalizzare un sito già valutato. */
  recheckAfterDays: number;
  /** Giorni entro cui una demo valida non viene rigenerata. */
  demoFreshDays: number;
  /** true = calcola e racconta, non scrive e non chiama. */
  dryRun: boolean;
  /** true = la Factory è ferma. */
  paused: boolean;
}

/** Valori predefiniti: `both`, ma con tetti conservativi. */
export const DEFAULT_LIMITS: FactoryLimits = {
  mode: "both",
  maxSiteAudits: 20,
  maxDemosPerDay: 5,
  maxAttemptsPerLead: 3,
  concurrency: 2,
  timeoutMs: 15_000,
  minOpportunityScore: 40,
  // Un sito rifatto o riparato merita un secondo sguardo, ma non domani.
  recheckAfterDays: 30,
  // Una demo di due settimane è ancora buona: rigenerarla è spesa pura.
  demoFreshDays: 14,
  dryRun: false,
  paused: false,
};

const num = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const text = (raw ?? "").trim();
  // Una env ASSENTE deve ricadere sul default, non essere letta come 0:
  // Number("") è 0 e Number.isFinite(0) è true, quindi senza questo
  // controllo ogni limite veniva clampato al proprio minimo e la Factory
  // girava con 1 audit e 1 demo al giorno.
  if (!text) return fallback;
  const v = Number(text);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.round(v), min), max);
};

const bool = (raw: string | undefined): boolean => {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
};

export function parseScoutMode(raw: string | undefined): ScoutMode {
  const v = (raw ?? "").trim().toLowerCase();
  return (SCOUT_MODES as string[]).includes(v) ? (v as ScoutMode) : DEFAULT_LIMITS.mode;
}

/**
 * Limiti effettivi dall'ambiente. Ogni valore è clampato: una env
 * scritta male (o messa a 100000 per sbaglio) non può far spendere più
 * del massimo previsto.
 */
export function loadLimits(env: Record<string, string | undefined> = process.env): FactoryLimits {
  return {
    mode: parseScoutMode(env.FACTORY_SCOUT_MODE),
    maxSiteAudits: num(env.FACTORY_MAX_SITE_AUDITS, DEFAULT_LIMITS.maxSiteAudits, 1, 200),
    maxDemosPerDay: num(env.FACTORY_MAX_DEMOS_PER_DAY, DEFAULT_LIMITS.maxDemosPerDay, 1, 50),
    maxAttemptsPerLead: num(env.FACTORY_MAX_ATTEMPTS, DEFAULT_LIMITS.maxAttemptsPerLead, 1, 10),
    concurrency: num(env.FACTORY_CONCURRENCY, DEFAULT_LIMITS.concurrency, 1, 5),
    timeoutMs: num(env.FACTORY_TIMEOUT_MS, DEFAULT_LIMITS.timeoutMs, 2_000, 60_000),
    minOpportunityScore: num(
      env.FACTORY_MIN_SCORE,
      DEFAULT_LIMITS.minOpportunityScore,
      0,
      100,
    ),
    recheckAfterDays: num(env.FACTORY_RECHECK_DAYS, DEFAULT_LIMITS.recheckAfterDays, 1, 365),
    demoFreshDays: num(env.FACTORY_DEMO_FRESH_DAYS, DEFAULT_LIMITS.demoFreshDays, 1, 365),
    dryRun: bool(env.FACTORY_DRY_RUN),
    paused: bool(env.FACTORY_PAUSED),
  };
}

/** Un lead con sito è ammesso solo in `weak_site` o `both`. */
export function modeAcceptsWebsite(mode: ScoutMode, hasWebsite: boolean): boolean {
  if (mode === "no_site") return !hasWebsite;
  if (mode === "weak_site") return hasWebsite;
  return true;
}

export interface RecheckInput {
  /** Data dell'ultima analisi, ISO o SQLite datetime. */
  checkedAt: string | null;
  /** Stato dell'ultima analisi. */
  status: string;
  now?: Date;
  recheckAfterDays: number;
}

/** Stati che sono un ESITO DEFINITIVO: non si rianalizza a ogni giro. */
const SETTLED_STATUSES = new Set(["acceptable", "no_website"]);

/**
 * Va rianalizzato? Un esito definitivo si ricontrolla solo dopo
 * `recheckAfterDays`: rifare ogni mattina la stessa richiesta a un sito
 * che è a posto è spesa inutile e, dal lato loro, traffico immotivato.
 */
export function shouldRecheck(input: RecheckInput): boolean {
  if (!input.checkedAt) return true;
  const parsed = new Date(
    input.checkedAt.includes("T") ? input.checkedAt : `${input.checkedAt.replace(" ", "T")}Z`,
  );
  if (Number.isNaN(parsed.getTime())) return true;
  if (!SETTLED_STATUSES.has(input.status)) return true;
  const now = input.now ?? new Date();
  const days = (now.getTime() - parsed.getTime()) / 86_400_000;
  return days >= input.recheckAfterDays;
}

export interface DemoFreshnessInput {
  /** Data di aggiornamento del progetto Forge. */
  updatedAt: string | null;
  stage: string;
  qaScore: number;
  now?: Date;
  demoFreshDays: number;
}

/** Fasi in cui esiste già una demo utilizzabile. */
const HAS_USABLE_DEMO = new Set([
  "ready",
  "outreach_ready",
  "sent",
  "viewed",
  "replied",
  "appointment",
  "negotiating",
  "won",
  "client_approved",
]);

/**
 * Esiste già una demo valida e recente? In quel caso non si rigenera:
 * la seconda demo costerebbe come la prima e sarebbe identica.
 */
export function hasFreshDemo(input: DemoFreshnessInput): boolean {
  if (!HAS_USABLE_DEMO.has(input.stage)) return false;
  if (input.qaScore <= 0) return false;
  if (!input.updatedAt) return false;
  const parsed = new Date(
    input.updatedAt.includes("T") ? input.updatedAt : `${input.updatedAt.replace(" ", "T")}Z`,
  );
  if (Number.isNaN(parsed.getTime())) return false;
  const now = input.now ?? new Date();
  const days = (now.getTime() - parsed.getTime()) / 86_400_000;
  return days < input.demoFreshDays;
}
