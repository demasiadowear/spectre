"use client";

import { slotsRemaining, currentTier } from "@/lib/pitch";
import { formatCurrency } from "@/lib/utils";
import type { Lead } from "@/types";

interface StatsBarProps {
  leads: Lead[];
}

/** First-come pricing + cash dashboard, mobile-first (2 cols → 4 cols). */
export default function StatsBar({ leads }: StatsBarProps) {
  const closed = leads.filter((l) => l.status === "closed");
  const cash = closed.reduce((s, l) => s + (l.meta.closed_price ?? l.value), 0);
  const slots = slotsRemaining(closed.length);
  const tier = currentTier(closed.length);
  const openValue = leads
    .filter((l) => l.status !== "closed" && l.status !== "lost")
    .reduce((s, l) => s + l.value, 0);

  const cards = [
    {
      label: "Cash incassato",
      value: formatCurrency(cash),
      extra: `${closed.length} chiusi`,
      highlight: true,
    },
    {
      label: `Tier ${tier === "FULL" ? "—" : tier} attuale`,
      value: tier === "FULL" ? "Listino" : `−${tier === "T1" ? 30 : tier === "T2" ? 20 : 10}%`,
      extra:
        tier === "FULL"
          ? "slot esauriti"
          : `${tier === "T1" ? slots.T1 : tier === "T2" ? slots.T2 : slots.T3} slot rimasti`,
      highlight: false,
    },
    {
      label: "Pipeline aperta",
      value: formatCurrency(openValue),
      extra: `${leads.filter((l) => l.status !== "closed" && l.status !== "lost").length} lead`,
      highlight: false,
    },
    {
      label: "Totale lead",
      value: String(leads.length),
      extra: `${leads.filter((l) => l.status === "lost").length} persi`,
      highlight: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`rounded-sm border p-3 ${
            c.highlight
              ? "border-spectre-green/40 bg-spectre-green/5"
              : "border-border bg-surface"
          }`}
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-muted">
            {c.label}
          </p>
          <p
            className={`mt-1 font-display text-lg font-bold leading-none ${
              c.highlight ? "text-spectre-green" : "text-spectre-text"
            }`}
          >
            {c.value}
          </p>
          <p className="mt-1 font-mono text-[10px] text-spectre-muted/70">{c.extra}</p>
        </div>
      ))}
    </div>
  );
}
