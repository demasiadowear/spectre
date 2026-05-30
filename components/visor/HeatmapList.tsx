"use client";

import { Flame } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import { SPECTRE } from "@/lib/constants";
import { cn, formatCurrency, urgencyScore } from "@/lib/utils";
import type { Lead } from "@/types";

interface HeatmapListProps {
  leads: Lead[];
}

function barColor(pct: number): string {
  if (pct > 80) return SPECTRE.magenta;
  if (pct >= 50) return SPECTRE.amber;
  return SPECTRE.green;
}

/** Top-5 most urgent open deals, ranked by urgency score. */
export default function HeatmapList({ leads }: HeatmapListProps) {
  const ranked = leads
    .filter((l) => l.status !== "closed" && l.status !== "lost")
    .map((l) => ({ lead: l, score: urgencyScore(l) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const max = ranked[0]?.score || 1;

  return (
    <GlassCard corners className="h-fit p-4">
      <div className="mb-3 flex items-center gap-2">
        <Flame className="h-4 w-4 text-spectre-magenta" />
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-spectre-text">
          Heatmap urgenza
        </h2>
      </div>

      {ranked.length === 0 ? (
        <p className="font-mono text-[11px] text-spectre-muted">
          Nessun deal aperto.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {ranked.map(({ lead, score }) => {
            const pct = Math.max(6, Math.round((score / max) * 100));
            const color = barColor(pct);
            return (
              <li key={lead.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate font-display text-xs text-spectre-text">
                    {lead.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-spectre-muted">
                    {formatCurrency(lead.value)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-sm bg-white/5">
                  <div
                    className={cn("h-full rounded-sm transition-all duration-500")}
                    style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}
