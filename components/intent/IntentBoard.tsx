"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import { cn } from "@/lib/utils";
import { INTENT_STAGES, INTENT_STAGE_LABELS } from "@/lib/intent/constants";
import type { IntentLead, IntentStage } from "@/types/intent";

// ============================================================
// Kanban dedicato ai lead intent (richieste pubblicate).
// Colonne: Trovato → Contattato → Meeting → Vinto / Perso.
// Card minime: titolo, piattaforma, score, zona, età, gancio.
// ============================================================

const STAGE_CHIP: Record<IntentStage, string> = {
  intent_found: "bg-fn-todo text-onaccent",
  contacted: "bg-fn-replied text-onaccent",
  meeting: "bg-fn-negotiating text-onaccent",
  won: "bg-fn-closed text-onaccent",
  lost: "bg-fn-lost text-onaccent",
};

function ageLabel(iso: string): string {
  if (!iso) return "—";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (Number.isNaN(h)) return "—";
  if (h < 1) return "adesso";
  if (h < 24) return `${Math.floor(h)}h fa`;
  return `${Math.floor(h / 24)}g fa`;
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-fn-closed";
  if (score >= 60) return "text-accent";
  return "text-text2";
}

function HookCopy({ hook }: { hook: string }) {
  const [copied, setCopied] = useState(false);
  if (!hook) return null;
  return (
    <button
      type="button"
      title={hook}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(hook);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard negata: il gancio resta leggibile nel tooltip */
        }
      }}
      className="inline-flex items-center gap-1 rounded border border-surface2 px-1.5 py-0.5 font-ui text-[10px] text-text2 hover:text-text"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      gancio
    </button>
  );
}

function IntentCard({
  lead,
  onMove,
}: {
  lead: IntentLead;
  onMove: (leadId: string, stage: IntentStage) => void;
}) {
  return (
    <li className="rounded border border-surface2 p-2">
      <div className="flex items-start justify-between gap-2">
        {/* href scrapato da siti terzi: si linka solo http(s). */}
        {lead.source_url.startsWith("http") ? (
          <a
            href={lead.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ui text-xs font-semibold text-text hover:text-accent"
          >
            {lead.title}
            <ExternalLink size={10} className="ml-1 inline" />
          </a>
        ) : (
          <span className="font-ui text-xs font-semibold text-text">
            {lead.title}
          </span>
        )}
        <span className={cn("font-display text-sm font-bold", scoreColor(lead.score))}>
          {lead.score}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 font-ui text-[10px] text-text2">
        <span className="uppercase">{lead.platform}</span>
        {lead.zone && <span>📍 {lead.zone}</span>}
        {lead.budget && <span>💰 {lead.budget}</span>}
        <span>{ageLabel(lead.published_at || lead.created_at)}</span>
        <HookCopy hook={lead.hook} />
      </div>
      <select
        aria-label="Sposta colonna"
        value={lead.stage}
        onChange={(e) => onMove(lead.lead_id, e.target.value as IntentStage)}
        className="mt-1.5 w-full rounded border border-surface2 bg-transparent px-1 py-0.5 font-ui text-[10px] text-text2"
      >
        {INTENT_STAGES.map((s) => (
          <option key={s} value={s}>
            {INTENT_STAGE_LABELS[s]}
          </option>
        ))}
      </select>
    </li>
  );
}

export default function IntentBoard() {
  const [leads, setLeads] = useState<IntentLead[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/intent/pipeline", {
        cache: "no-store",
        // Senza timeout una richiesta appesa lascia "Caricamento…" per sempre.
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Errore caricamento");
      setLeads(json.data.leads);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onMove = useCallback(
    async (leadId: string, stage: IntentStage) => {
      // Ottimistico: nuova lista, nessuna mutazione in place.
      setLeads((prev) =>
        prev.map((l) => (l.lead_id === leadId ? { ...l, stage } : l)),
      );
      try {
        const res = await fetch("/api/intent/pipeline", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: leadId, stage }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || "Salvataggio fallito");
      } catch (err) {
        setError((err as Error).message);
        void load(); // rollback: ricarica lo stato reale dal DB
      }
    },
    [load],
  );

  if (loading) {
    return <p className="font-ui text-sm text-text2">Caricamento…</p>;
  }
  if (error) {
    return <p className="font-ui text-sm text-fn-lost">{error}</p>;
  }
  if (leads.length === 0) {
    return (
      <p className="font-ui text-sm text-text2">
        Nessun lead intent ancora: lo scout gira ogni 2 ore (7-21).
      </p>
    );
  }

  const byStage = new Map<IntentStage, IntentLead[]>(
    INTENT_STAGES.map((s) => [s, []]),
  );
  for (const l of leads) byStage.get(l.stage)?.push(l);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {INTENT_STAGES.map((stage) => {
        const items = byStage.get(stage) ?? [];
        return (
          <GlassCard key={stage} className="flex flex-col p-3">
            <div className="mb-2 flex items-center justify-between border-b border-surface2 pb-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-ui text-[10px]",
                  STAGE_CHIP[stage],
                )}
              >
                {INTENT_STAGE_LABELS[stage]}
              </span>
              <span className="font-display text-sm font-bold text-text">
                {items.length}
              </span>
            </div>
            <ul className="space-y-1.5">
              {items.map((l) => (
                <IntentCard key={l.lead_id} lead={l} onMove={onMove} />
              ))}
            </ul>
          </GlassCard>
        );
      })}
    </div>
  );
}
