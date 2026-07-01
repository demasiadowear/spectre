import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Lead } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Molte colonne (leads.last_contact/created_at/updated_at) hanno il
 * default SQL `datetime('now')`, che produce "YYYY-MM-DD HH:MM:SS"
 * SENZA suffisso "Z" — a differenza dei timestamp che l'app scrive
 * essa stessa con `toISOString()` (che hanno sempre "Z", quindi sono
 * UTC inequivocabile). `new Date("2026-06-30 14:00:00")` viene
 * interpretata come ORA LOCALE del processo, non UTC: se il server
 * gira in un fuso diverso da UTC, i lead con timestamp "di default"
 * finiscono con giorni/ore sfalsati rispetto a quelli scritti dall'app.
 * Qui si forza "Z" quando manca, cosi il valore letto dal DB è sempre
 * trattato come UTC (comportamento allineato a components/autopilot/
 * format.ts:parseDbDate). */
function parseTimestamp(value: string): Date | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Italian compact relative time: "ora", "12m fa", "2h fa", "3g fa". */
export function relativeTime(iso: string): string {
  const then = parseTimestamp(iso)?.getTime();
  if (then == null) return "—";
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "ora";
  if (min < 60) return `${min}m fa`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h fa`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}g fa`;
  const months = Math.floor(days / 30);
  return `${months}mes fa`;
}

/** Whole days since the given timestamp (min 0). */
export function daysSince(iso: string): number {
  const then = parseTimestamp(iso)?.getTime();
  if (then == null) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/** Numero da un body JSON, accettando sia number che stringa numerica
 *  ("20"): `Number.isFinite("20")` è false, quindi un client che manda
 *  il limite come stringa (form HTML, query param) veniva ignorato in
 *  silenzio e ricadeva sul default. */
export function parseOptionalNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** € formatting, Italian locale, no decimals. */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Urgency score = value × probability / days_since_contact (clamped).
 * Higher = needs attention sooner. Used by the VISOR heatmap.
 */
export function urgencyScore(lead: Lead): number {
  const days = Math.max(1, daysSince(lead.last_contact));
  return Math.round((lead.value * (lead.probability / 100)) / days);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
