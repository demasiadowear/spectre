"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Download, LayoutGrid, List, Phone, Plus, Search } from "lucide-react";
import { useHudStore } from "@/lib/store";
import { useVoiceStore } from "@/lib/voice/store";
import {
  LEAD_STATUS,
  PIPELINE_ORDER,
  STATUS_SHORT,
  statusCardClass,
  statusIsFill,
} from "@/lib/constants";
import { cn, formatCurrency } from "@/lib/utils";
import { isMobilePhone, isStale, nextBestAction, telUrl } from "@/lib/pitch";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import HeatmapList from "./HeatmapList";
import LeadActionPanel from "./LeadActionPanel";
import NewLeadModal from "./NewLeadModal";
import PipelineColumn from "./PipelineColumn";
import StatsBar from "./StatsBar";
import type { ApiResponse, Lead, LeadStatus } from "@/types";

interface VisorBoardProps {
  initialLeads: Lead[];
}

type FilterKey = LeadStatus | "all" | "wa" | "fisso";

// Display labels for known segments; unknown ones (auto-created from a hunt)
// fall back to a capitalised version of their slug.
const SEG_LABELS: Record<string, string> = {
  ristoranti: "🍝 Ristoranti",
  beauty: "💅 Beauty",
  parrucchiere: "✂️ Parrucchieri",
  barbiere: "💈 Barbieri",
  estetista: "💅 Estetiste",
  "tattoo studio": "🖋️ Tattoo",
  palestra: "🏋️ Palestre",
  pizzeria: "🍕 Pizzerie",
  bar: "☕ Bar",
  dentista: "🦷 Dentisti",
  avvocato: "⚖️ Avvocati",
  commercialista: "📊 Commercialisti",
};
function segLabel(s: string): string {
  return SEG_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

export default function VisorBoard({ initialLeads }: VisorBoardProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [view, setView] = useState<"list" | "kanban">("list");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<string>("all");
  const setHudStats = useHudStore((s) => s.setHudStats);

  const pendingAction = useVoiceStore((s) => s.pendingAction);
  const consumeAction = useVoiceStore((s) => s.consumeAction);

  // Desktop → kanban by default, mobile → list. One-shot on mount.
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      setView("kanban");
    }
  }, []);

  // Keep HUD counters in sync (always full set).
  useEffect(() => {
    const active = leads.filter((l) => l.status !== "closed" && l.status !== "lost");
    setHudStats({
      activeLeads: active.length,
      dealValueOpen: active.reduce((sum, l) => sum + l.value, 0),
      negotiatingValue: leads
        .filter((l) => l.status === "negotiating")
        .reduce((sum, l) => sum + l.value, 0),
    });
  }, [leads, setHudStats]);

  // Voice command bus.
  useEffect(() => {
    if (!pendingAction || pendingAction.module !== "visor") return;
    const { kind, payload } = pendingAction;
    consumeAction();
    if (kind === "search") {
      setFilter("all");
      setQuery(String(payload.query ?? ""));
    } else if (kind === "filter") {
      const s = String(payload.status ?? "");
      const valid: LeadStatus[] = [
        "todo",
        "step1_sent",
        "replied",
        "step2_sent",
        "preview_sent",
        "negotiating",
        "closed",
        "lost",
      ];
      setQuery("");
      setFilter(valid.includes(s as LeadStatus) ? (s as LeadStatus) : "all");
    } else if (kind === "refresh") {
      void refresh();
    }
  }, [pendingAction, consumeAction]);

  async function refresh() {
    try {
      const res = await fetch("/api/leads");
      const json = (await res.json()) as ApiResponse<Lead[]>;
      if (json.success && json.data) setLeads(json.data);
    } catch {
      /* ignore */
    }
  }

  function applyUpdate(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setSelected((cur) => (cur && cur.id === updated.id ? updated : cur));
  }

  const segmentLeads = useMemo(
    () =>
      segment === "all"
        ? leads
        : leads.filter((l) => (l.meta.segmento ?? "ristoranti") === segment),
    [leads, segment],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return segmentLeads.filter((l) => {
      if (filter === "wa" && !isMobilePhone(l.phone)) return false;
      if (filter === "fisso" && isMobilePhone(l.phone)) return false;
      if (
        filter !== "all" &&
        filter !== "wa" &&
        filter !== "fisso" &&
        l.status !== filter
      )
        return false;
      if (q && !`${l.name} ${l.company}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [segmentLeads, filter, query]);

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(
      [...PIPELINE_ORDER, "lost"].map((s) => [s, [] as Lead[]]),
    ) as Record<LeadStatus, Lead[]>;
    for (const lead of filtered) (map[lead.status] ??= []).push(lead);
    return map;
  }, [filtered]);

  // List view: open leads first (by urgency), then closed/lost.
  const listSorted = useMemo(() => {
    const order: Record<LeadStatus, number> = {
      todo: 0,
      step1_sent: 1,
      replied: 2,
      step2_sent: 3,
      preview_sent: 4,
      negotiating: 5,
      closed: 6,
      lost: 7,
    };
    return [...filtered].sort((a, b) => {
      const sa = order[a.status];
      const sb = order[b.status];
      if (sa !== sb) return sa - sb;
      return Number(isStale(b)) - Number(isStale(a)) || b.value - a.value;
    });
  }, [filtered]);

  async function handleDrop(id: string, status: LeadStatus) {
    setDraggingId(null);
    const current = leads.find((l) => l.id === id);
    if (!current || current.status === status) return;
    const prevStatus = current.status;
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, last_contact: new Date().toISOString() }),
      });
      const json: ApiResponse<Lead> = await res.json();
      if (!json.success || !json.data) throw new Error();
      applyUpdate(json.data);
    } catch {
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status: prevStatus } : l)),
      );
    }
  }

  // One-click "non interessato" → lost (so Hunter skips it in future searches).
  async function discardLead(id: string) {
    const current = leads.find((l) => l.id === id);
    if (!current || current.status === "lost") return;
    const prevStatus = current.status;
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status: "lost" } : l)),
    );
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "lost",
          meta: { ...current.meta, lost_reason: "Non interessato" },
        }),
      });
      const json: ApiResponse<Lead> = await res.json();
      if (!json.success || !json.data) throw new Error();
      applyUpdate(json.data);
    } catch {
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status: prevStatus } : l)),
      );
    }
  }

  function findByPhone() {
    const input = window.prompt("Incolla il numero WhatsApp del lead:");
    if (!input) return;
    const digits = input.replace(/\D/g, "").replace(/^39/, "");
    if (digits.length < 6) return;
    const hit = leads.find((l) => {
      const ld = l.phone.replace(/\D/g, "").replace(/^39/, "");
      return ld.endsWith(digits.slice(-9)) || digits.endsWith(ld.slice(-9));
    });
    if (hit) setSelected(hit);
    else window.alert("Nessun lead trovato per quel numero.");
  }

  function exportCsv() {
    const head = [
      "name",
      "company",
      "phone",
      "status",
      "value",
      "rating",
      "reviews",
      "address",
      "closed_price",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = leads.map((l) =>
      [
        l.name,
        l.company,
        l.phone,
        l.status,
        l.value,
        l.meta.rating ?? "",
        l.meta.reviews ?? "",
        l.meta.address ?? "",
        l.meta.closed_price ?? "",
      ]
        .map(esc)
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spectre-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filterChips: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "Tutti", count: segmentLeads.length },
    ...PIPELINE_ORDER.map((s) => ({
      key: s as FilterKey,
      label: STATUS_SHORT[s],
      count: segmentLeads.filter((l) => l.status === s).length,
    })),
    { key: "lost", label: "Lost", count: segmentLeads.filter((l) => l.status === "lost").length },
    { key: "wa", label: "📱 WhatsApp", count: segmentLeads.filter((l) => isMobilePhone(l.phone)).length },
    { key: "fisso", label: "☎ Fisso", count: segmentLeads.filter((l) => !isMobilePhone(l.phone)).length },
  ];

  // Segments are dynamic: derived from the distinct meta.segmento on the
  // leads, so importing a new category from the Hunter auto-creates its chip.
  const segOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of leads) {
      const s = l.meta.segmento ?? "ristoranti";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const dynamic = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: segLabel(key), count }));
    return [
      { key: "all", label: "Tutti", count: leads.length },
      ...dynamic,
    ];
  }, [leads]);

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <NeonButton variant="cyan" filled size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Nuovo
        </NeonButton>
        <NeonButton variant="green" size="sm" onClick={findByPhone}>
          <Phone className="h-3.5 w-3.5" /> Trova da n°
        </NeonButton>
        <NeonButton variant="ghost" size="sm" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5" /> CSV
        </NeonButton>
        <div className="ml-auto flex overflow-hidden rounded-sm border border-border">
          <button
            type="button"
            onClick={() => setView("list")}
            aria-label="Vista lista"
            className={cn(
              "flex h-8 w-9 items-center justify-center",
              view === "list" ? "bg-spectre-cyan/15 text-spectre-cyan" : "text-spectre-muted",
            )}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("kanban")}
            aria-label="Vista kanban"
            className={cn(
              "flex h-8 w-9 items-center justify-center",
              view === "kanban" ? "bg-spectre-cyan/15 text-spectre-cyan" : "text-spectre-muted",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Segmento */}
      <div className="mt-3 flex items-center gap-2">
        <span className="hidden text-[10px] uppercase tracking-[0.2em] text-text2 sm:inline">
          Segmento
        </span>
        <div className="flex overflow-hidden rounded-sm border border-border">
          {segOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setSegment(o.key)}
              className={cn(
                "px-3 py-1.5 text-[11px] uppercase tracking-[0.1em] transition-colors",
                segment === o.key
                  ? "bg-accent text-onaccent"
                  : "text-text2 hover:text-text",
              )}
            >
              {o.label} · {o.count}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="mt-3">
        <StatsBar leads={segmentLeads} />
      </div>

      {/* Search + filters */}
      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-spectre-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca lead…"
            className="w-full rounded-sm border border-border bg-surface py-2 pl-8 pr-3 font-mono text-xs text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-cyan/50 focus:outline-none"
          />
        </div>
      </div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {filterChips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            className={cn(
              "shrink-0 rounded-sm border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
              filter === c.key
                ? "border-spectre-cyan/60 bg-spectre-cyan/15 text-spectre-cyan"
                : "border-border text-spectre-muted hover:border-spectre-cyan/30",
            )}
          >
            {c.label} · {c.count}
          </button>
        ))}
      </div>

      {leads.length === 0 ? (
        <GlassCard corners className="mt-4 py-12 text-center">
          <p className="font-mono text-sm text-spectre-muted">Nessun lead nel database.</p>
          <p className="mt-2 font-mono text-sm text-spectre-cyan">
            Clicca “NUOVO” o usa l’Hunter per trovare attività.
          </p>
        </GlassCard>
      ) : view === "list" ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-2">
            {listSorted.length === 0 ? (
              <p className="py-8 text-center font-mono text-xs text-spectre-muted">
                Nessun lead con questo filtro.
              </p>
            ) : (
              listSorted.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  onClick={() => setSelected(lead)}
                  onDiscard={() => discardLead(lead.id)}
                />
              ))
            )}
          </div>
          <div className="hidden xl:block">
            <HeatmapList leads={filtered} />
          </div>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto pb-3">
          <div className="flex gap-3" style={{ minWidth: "max-content" }}>
            {[...PIPELINE_ORDER, "lost" as LeadStatus].map((status) => (
              <PipelineColumn
                key={status}
                status={status}
                leads={byStatus[status]}
                draggingId={draggingId}
                onDragStartCard={setDraggingId}
                onDragEndCard={() => setDraggingId(null)}
                onDropLead={handleDrop}
                onSelectCard={(id) => {
                  const l = leads.find((x) => x.id === id);
                  if (l) setSelected(l);
                }}
              />
            ))}
          </div>
        </div>
      )}

      <NewLeadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(lead) => {
          setLeads((prev) => [lead, ...prev]);
          setSelected(lead);
        }}
      />

      {selected && (
        <LeadActionPanel
          lead={selected}
          onClose={() => setSelected(null)}
          onUpdate={applyUpdate}
        />
      )}
    </>
  );
}

/** Compact, fully tappable lead row for the mobile-first list view.
 *  A div (not a button) so it can hold the click-to-call link + discard
 *  action; tapping the body opens the panel, the actions stopPropagation. */
function LeadRow({
  lead,
  onClick,
  onDiscard,
}: {
  lead: Lead;
  onClick: () => void;
  onDiscard: () => void;
}) {
  const meta = LEAD_STATUS[lead.status];
  const action = nextBestAction(lead);
  const mobile = isMobilePhone(lead.phone);
  const fill = statusIsFill(lead.status);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "w-full cursor-pointer rounded-sm p-3 text-left transition-colors",
        statusCardClass(lead.status),
        !fill && "hover:border-accent/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={cn(
              "truncate font-display text-sm font-medium",
              fill ? "text-white" : "text-spectre-text",
            )}
          >
            {mobile ? "📱 " : "☎ "}
            {lead.name}
          </p>
          <p
            className={cn(
              "mt-0.5 truncate text-[11px]",
              fill ? "text-white/75" : "text-spectre-muted",
            )}
          >
            {action.title}
          </p>
        </div>

        {/* Quick actions — call (native dialer) + discard. */}
        <div className="flex shrink-0 items-center gap-1.5" onClick={stop}>
          {lead.phone && (
            <a
              href={telUrl(lead.phone)}
              onClick={stop}
              aria-label={`Chiama ${lead.name}`}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-sm border",
                fill
                  ? "border-white/40 text-white"
                  : "border-spectre-green/40 bg-spectre-green/10 text-spectre-green",
              )}
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
          {lead.status !== "lost" && (
            <button
              type="button"
              aria-label="Non interessato"
              title="Non interessato"
              onClick={(e) => {
                e.stopPropagation();
                onDiscard();
              }}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-sm border",
                fill
                  ? "border-white/40 text-white"
                  : "border-border text-spectre-muted hover:border-spectre-magenta/40 hover:text-spectre-magenta",
              )}
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        {fill ? (
          <span className="rounded-sm border border-white/40 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-white">
            {meta.label}
          </span>
        ) : (
          <span
            className={cn(
              "rounded-sm border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em]",
              meta.badge,
            )}
          >
            {meta.label}
          </span>
        )}
        <span className={cn("text-[11px]", fill ? "text-white" : "text-accent")}>
          {formatCurrency(lead.value)}
        </span>
      </div>
    </div>
  );
}
