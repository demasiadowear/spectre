"use client";

import { formatCurrency } from "@/lib/utils";
import type { Lead } from "@/types";

interface StatsBarProps {
  leads: Lead[];
}

/** First-come pricing + cash dashboard, mobile-first (2 cols → 4 cols). */
export default function StatsBar({ leads }: StatsBarProps) {
  const closed = leads.filter((l) => l.status === "closed");
  const lost = leads.filter((l) => l.status === "lost").length;
  const cash = closed.reduce((s, l) => s + (l.meta.closed_price ?? l.value), 0);
  const openLeads = leads.filter(
    (l) => l.status !== "closed" && l.status !== "lost",
  );
  const openValue = openLeads.reduce((s, l) => s + l.value, 0);
  const worked = closed.length + lost;
  const closeRate = worked > 0 ? Math.round((closed.length / worked) * 100) : 0;

  const cards = [
    {
      label: "Cash incassato",
      value: formatCurrency(cash),
      extra: `${closed.length} chiusi`,
      highlight: true,
    },
    {
      label: "Tasso chiusura",
      value: `${closeRate}%`,
      extra: `${closed.length} vinti · ${lost} persi`,
      highlight: false,
    },
    {
      label: "Pipeline aperta",
      value: formatCurrency(openValue),
      extra: `${openLeads.length} lead`,
      highlight: false,
    },
    {
      label: "Totale lead",
      value: String(leads.length),
      extra: `${lost} persi`,
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
