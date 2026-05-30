"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { LEAD_STATUS, statusCardClass, statusIsFill } from "@/lib/constants";
import { cn, formatCurrency } from "@/lib/utils";
import { isStale, nextBestAction, waitingHours } from "@/lib/pitch";
import LeadActionPanel from "@/components/visor/LeadActionPanel";
import type { Lead, LeadStatus } from "@/types";

interface CockpitBoardProps {
  initialLeads: Lead[];
}

type Bucket = "urgent" | "respond" | "close" | "prepare" | "contact" | "waiting";

const BUCKET_META: Record<
  Bucket,
  { label: string; hint: string; accent: string }
> = {
  urgent: { label: "🔥 Urgenti", hint: "Aspettano da troppo — agisci ora", accent: "text-spectre-magenta" },
  respond: { label: "💬 Hanno risposto", hint: "Manda lo Step 2 di conferma", accent: "text-spectre-amber" },
  close: { label: "🎯 Da chiudere", hint: "Preview consegnata / in trattativa", accent: "text-spectre-green" },
  prepare: { label: "🛠 Da preparare", hint: "Genera e manda la preview", accent: "text-purple-300" },
  contact: { label: "👋 Da contattare", hint: "Primo messaggio Step 1", accent: "text-slate-300" },
  waiting: { label: "📨 In attesa", hint: "Step 1 inviato, aspetta risposta", accent: "text-spectre-cyan" },
};

const ORDER: Bucket[] = ["urgent", "respond", "close", "prepare", "contact", "waiting"];

function bucketOf(lead: Lead): Bucket | null {
  if (lead.status === "closed" || lead.status === "lost") return null;
  if (isStale(lead)) return "urgent";
  if (lead.status === "replied") return "respond";
  if (lead.status === "preview_sent" || lead.status === "negotiating") return "close";
  if (lead.status === "step2_sent") return "prepare";
  if (lead.status === "todo") return "contact";
  return "waiting"; // step1_sent
}

export default function CockpitBoard({ initialLeads }: CockpitBoardProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [selected, setSelected] = useState<Lead | null>(null);

  const closedCount = useMemo(
    () => leads.filter((l) => l.status === "closed").length,
    [leads],
  );

  const grouped = useMemo(() => {
    const map: Record<Bucket, Lead[]> = {
      urgent: [], respond: [], close: [], prepare: [], contact: [], waiting: [],
    };
    for (const l of leads) {
      const b = bucketOf(l);
      if (b) map[b].push(l);
    }
    // Inside each bucket: longest-waiting first.
    for (const b of ORDER) map[b].sort((a, c) => waitingHours(c) - waitingHours(a));
    return map;
  }, [leads]);

  const openLeads = leads.filter((l) => l.status !== "closed" && l.status !== "lost");
  const openValue = openLeads.reduce((s, l) => s + l.value, 0);
  const todoToday = grouped.urgent.length + grouped.respond.length + grouped.close.length;

  function applyUpdate(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setSelected((cur) => (cur && cur.id === updated.id ? updated : cur));
  }

  return (
    <>
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-sm border border-spectre-magenta/40 bg-spectre-magenta/5 p-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-muted">
            Da fare oggi
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-spectre-magenta">
            {todoToday}
          </p>
        </div>
        <div className="rounded-sm border border-border bg-surface p-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-muted">
            Lead aperti
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-spectre-text">
            {openLeads.length}
          </p>
        </div>
        <div className="rounded-sm border border-border bg-surface p-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-muted">
            Pipeline
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-spectre-cyan">
            {formatCurrency(openValue)}
          </p>
        </div>
      </div>

      {openLeads.length === 0 ? (
        <p className="mt-8 text-center font-mono text-sm text-spectre-muted">
          Nessun lead aperto. Vai sull’Hunter o nel Visor.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {ORDER.map((b) => {
            const items = grouped[b];
            if (items.length === 0) return null;
            const meta = BUCKET_META[b];
            return (
              <section key={b}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className={cn("font-display text-sm font-bold", meta.accent)}>
                    {meta.label}
                  </h2>
                  <span className="font-mono text-[11px] text-spectre-muted">
                    {items.length}
                  </span>
                  <span className="hidden font-mono text-[10px] text-spectre-muted/60 sm:inline">
                    · {meta.hint}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((lead) => (
                    <ActionRow
                      key={lead.id}
                      lead={lead}
                      urgent={b === "urgent"}
                      onClick={() => setSelected(lead)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {selected && (
        <LeadActionPanel
          lead={selected}
          closedCount={closedCount}
          onClose={() => setSelected(null)}
          onUpdate={applyUpdate}
        />
      )}
    </>
  );
}

function ActionRow({
  lead,
  urgent,
  onClick,
}: {
  lead: Lead;
  urgent: boolean;
  onClick: () => void;
}) {
  const action = nextBestAction(lead);
  const sm = LEAD_STATUS[lead.status as LeadStatus];
  const fill = statusIsFill(lead.status);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-sm p-3 text-left transition-colors",
        statusCardClass(lead.status),
        !fill && "hover:border-accent/40",
      )}
    >
      {urgent && (
        <AlertTriangle
          className={cn("h-4 w-4 shrink-0", fill ? "text-white" : "text-accent")}
        />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate font-display text-sm font-medium",
            fill ? "text-white" : "text-spectre-text",
          )}
        >
          {lead.name}
        </p>
        <p
          className={cn(
            "truncate text-[11px]",
            fill ? "text-white/75" : "text-spectre-muted",
          )}
        >
          {action.title}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {fill ? (
          <span className="rounded-sm border border-white/40 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-white">
            {sm.label}
          </span>
        ) : (
          <span
            className={cn(
              "rounded-sm border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em]",
              sm.badge,
            )}
          >
            {sm.label}
          </span>
        )}
        <span className={cn("text-[11px]", fill ? "text-white" : "text-accent")}>
          {formatCurrency(lead.value)}
        </span>
      </div>
      <ChevronRight
        className={cn("h-4 w-4 shrink-0", fill ? "text-white/70" : "text-spectre-muted")}
      />
    </button>
  );
}
