"use client";

import { useEffect, useState } from "react";
import {
  Ban,
  Check,
  FileText,
  Globe,
  Loader2,
  Phone,
  Plus,
  Star,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import LoadingGrid from "@/components/ui/spectre/LoadingGrid";
import TypingText from "@/components/ui/spectre/TypingText";
import { SPECTRE } from "@/lib/constants";
import type { HuntResult, HunterPriority, ScoredLead } from "@/types/hunter";

interface HunterResultsProps {
  leads: ScoredLead[];
  source: HuntResult["source"] | null;
  loading: boolean;
  error: string | null;
  hasSearched: boolean;
  importingId: string | null;
  importedIds: Set<string>;
  onGenerateScript: (lead: ScoredLead) => void;
  onImport: (lead: ScoredLead) => void;
  onDiscard: (lead: ScoredLead) => void;
  onImportAll: () => void;
  importingAll: boolean;
}

const PAGE = 8;

function scoreColor(score: number): string {
  if (score >= 80) return SPECTRE.cyan;
  if (score >= 60) return SPECTRE.amber;
  return SPECTRE.magenta;
}

const PRIORITY_CLS: Record<HunterPriority, string> = {
  HOT: "border-spectre-magenta/40 text-spectre-magenta bg-spectre-magenta/10",
  WARM: "border-spectre-amber/40 text-spectre-amber bg-spectre-amber/10",
  COLD: "border-slate-400/30 text-slate-300 bg-slate-400/10",
};

export default function HunterResults({
  leads,
  source,
  loading,
  error,
  hasSearched,
  importingId,
  importedIds,
  onGenerateScript,
  onImport,
  onDiscard,
  onImportAll,
  importingAll,
}: HunterResultsProps) {
  const [visible, setVisible] = useState(PAGE);

  // Reset pagination whenever a new result set arrives.
  useEffect(() => {
    setVisible(PAGE);
  }, [leads]);

  if (loading) {
    return (
      <GlassCard corners className="flex h-64 items-center justify-center">
        <LoadingGrid label="HUNT IN CORSO" />
      </GlassCard>
    );
  }

  if (error) {
    return (
      <GlassCard corners glow="magenta" className="p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spectre-magenta">
          {error}
        </p>
      </GlassCard>
    );
  }

  if (!hasSearched) {
    return (
      <GlassCard corners className="p-10 text-center">
        <p className="font-mono text-xs leading-relaxed text-spectre-muted">
          <TypingText text="Imposta zona e categoria, poi lancia l'hunt per acquisire target." />
        </p>
      </GlassCard>
    );
  }

  if (leads.length === 0) {
    return (
      <GlassCard corners glow="magenta" className="p-10 text-center">
        <p className="font-display text-lg font-bold tracking-[0.15em] text-spectre-magenta">
          NESSUN TARGET RILEVATO
        </p>
        <p className="mt-2 font-mono text-xs text-spectre-muted">
          <TypingText text="Allarga il raggio, abbassa il rating minimo o cambia categoria." />
        </p>
      </GlassCard>
    );
  }

  const remaining = leads.filter((l) => !importedIds.has(l.id)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-spectre-muted">
          {leads.length} target ·{" "}
          <span className="text-spectre-cyan">ordinati per score</span>
        </span>
        <div className="flex items-center gap-2">
          <NeonButton
            variant="green"
            size="sm"
            filled
            disabled={importingAll || remaining === 0}
            onClick={onImportAll}
            title="Importa tutti i risultati in Visor (crea il segmento)"
          >
            {importingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
            Importa tutti{remaining > 0 ? ` (${remaining})` : ""}
          </NeonButton>
          {source && (
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted/60">
              {source === "google-places" ? "google maps" : "demo"}
            </span>
          )}
        </div>
      </div>

      {leads.slice(0, visible).map((lead) => {
        const imported = importedIds.has(lead.id);
        const importing = importingId === lead.id;
        return (
          <GlassCard
            key={lead.id}
            className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center"
          >
            {/* Identity */}
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-medium text-spectre-text">
                {lead.name}
              </p>
              <p className="truncate font-mono text-[11px] text-spectre-muted">
                {lead.address || "—"}
              </p>
              {lead.phone && (
                <a
                  href={`tel:${lead.phone.replace(/\s+/g, "")}`}
                  className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-spectre-cyan transition hover:text-glow-cyan"
                >
                  <Phone className="h-3 w-3" strokeWidth={1.5} />
                  {lead.phone}
                </a>
              )}
            </div>

            {/* Signals */}
            <div className="flex items-center gap-4 lg:w-44">
              <span className="flex items-center gap-1 font-mono text-xs text-spectre-amber">
                <Star className="h-3.5 w-3.5 fill-spectre-amber" strokeWidth={0} />
                {lead.rating.toFixed(1)}
                <span className="text-spectre-muted">({lead.reviews})</span>
              </span>
              {lead.has_website ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-muted">
                  <Globe className="h-3 w-3" strokeWidth={1.5} /> Ha sito
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-spectre-magenta/40 bg-spectre-magenta/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-magenta shadow-neon-magenta">
                  No sito
                </span>
              )}
            </div>

            {/* Score block */}
            <div className="flex items-center gap-4 lg:w-44">
              <div className="flex flex-col items-center">
                <span
                  className="font-mono text-2xl font-bold leading-none tabular-nums"
                  style={{ color: scoreColor(lead.hunter_score) }}
                >
                  {lead.hunter_score}
                </span>
                <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-spectre-muted">
                  score
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span
                  className={`rounded-sm border px-2 py-0.5 text-center font-mono text-[9px] uppercase tracking-[0.15em] ${PRIORITY_CLS[lead.priority]}`}
                >
                  {lead.priority}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 lg:w-auto">
              <NeonButton
                variant="cyan"
                size="sm"
                onClick={() => onGenerateScript(lead)}
              >
                <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
                Script
              </NeonButton>
              <NeonButton
                variant="green"
                size="sm"
                filled={imported}
                disabled={imported || importing}
                onClick={() => onImport(lead)}
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                ) : imported ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
                {imported ? "In Visor" : "Visor"}
              </NeonButton>
              <NeonButton
                variant="magenta"
                size="sm"
                onClick={() => onDiscard(lead)}
                title="Non interessato — non riapparirà nelle ricerche"
              >
                <Ban className="h-3.5 w-3.5" strokeWidth={1.5} />
                Scarta
              </NeonButton>
            </div>
          </GlassCard>
        );
      })}

      {leads.length > visible && (
        <div className="flex justify-center pt-2">
          <NeonButton
            variant="ghost"
            size="sm"
            onClick={() => setVisible((v) => v + PAGE)}
          >
            Carica altri ({leads.length - visible})
          </NeonButton>
        </div>
      )}
    </div>
  );
}
