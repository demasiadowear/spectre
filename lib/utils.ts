import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Lead } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Italian compact relative time: "ora", "12m fa", "2h fa", "3g fa". */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
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
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
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
