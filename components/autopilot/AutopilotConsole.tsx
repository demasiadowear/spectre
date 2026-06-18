"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BookOpen, Columns3, Download, List } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type {
  AutopilotAlert,
  AutopilotLead,
  AutopilotStats,
} from "@/types/autopilot";
import AutopilotKanban from "./AutopilotKanban";
import AutopilotLeadDrawer, { type ConversationResult } from "./AutopilotLeadDrawer";
import AutopilotLeadRow from "./AutopilotLeadRow";
import { actionPriority, isReadyToContact, sortByAction } from "./format";

// ============================================================
// AUTOPILOT console — copilota MANUALE. Scout+Study trovano e
// preparano i lead; Puccio contatta a mano (wa.me), incolla le
// risposte, SPECTRE le smista e suggerisce. Nessun worker, nessun
// invio automatico. Poll ogni 30s.
// ============================================================

type ViewMode = "list" | "kanban";

type StatusFilter =
  | "azione"
  | "agenda"
  | "tutti"
  | "escalation"
  | "risposti"
  | "trattative"
  | "chiusi"
  | "da_contattare"
  | "demo"
  | "contattati"
  | "nuovi"
  | "archiviati";

/** Stati di trattativa (smistati dal triage o impostati a mano). */
const DEAL_FILTER_STAGES = [
  "da_chiamare",
  "demo_richiesta",
  "demo_inviata",
  "richiesta_prezzo",
  "in_trattativa",
  "tiepido",
] as const;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "azione", label: "Richiede azione" },
  { id: "agenda", label: "Agenda" },
  { id: "tutti", label: "Tutti" },
  { id: "da_contattare", label: "Da contattare" },
  { id: "risposti", label: "Da rispondere" },
  { id: "trattative", label: "Trattative" },
  { id: "demo", label: "Demo" },
  { id: "contattati", label: "Contattati" },
  { id: "chiusi", label: "Vinti / Persi" },
  { id: "nuovi", label: "Nuovi" },
  { id: "escalation", label: "Escalation" },
  { id: "archiviati", label: "Archiviati" },
];

const EMPTY_STATES: Record<StatusFilter, string> = {
  azione: "Niente da fare adesso. Lo scout gira ogni mattina alle 6.",
  agenda: "Nessuna azione pianificata: fissa data e prossima azione dal dettaglio lead.",
  tutti: "Nessun lead in pipeline. Lo scout gira ogni mattina alle 6.",
  escalation: "Nessuna escalation aperta.",
  risposti: "Nessuna risposta da gestire.",
  trattative: "Nessuna trattativa aperta.",
  chiusi: "Ancora nessun vinto o perso.",
  da_contattare: "Nessun lead pronto da contattare: lo study li sta preparando.",
  demo: "Nessuna demo in corso.",
  contattati: "Nessun lead contattato in attesa di risposta.",
  nuovi: "Nessun lead nuovo: lo study li ha già processati tutti.",
  archiviati: "Archivio vuoto.",
};

// REGOLA: ogni lead DEVE matchare almeno un filtro oltre a "tutti".
function matchesStatus(lead: AutopilotLead, f: StatusFilter): boolean {
  switch (f) {
    case "azione":
      return actionPriority(lead) < 3;
    case "agenda":
      return Boolean(lead.next_action_at) && lead.stage !== "archiviato" && lead.stage !== "perso";
    case "tutti":
      return true;
    case "escalation":
      return lead.stage === "escalation";
    case "risposti":
      return lead.stage === "risposto_manuale";
    case "trattative":
      return (DEAL_FILTER_STAGES as readonly string[]).includes(lead.stage);
    case "chiusi":
      return lead.stage === "vinto" || lead.stage === "perso";
    case "da_contattare":
      return isReadyToContact(lead);
    case "demo":
      return lead.stage === "demo_richiesta" || lead.stage === "demo_inviata";
    case "contattati":
      return lead.stage === "contattato";
    case "nuovi":
      return lead.stage === "nuovo";
    case "archiviati":
      return lead.stage === "archiviato";
  }
}

function Chip({
  label,
  count,
  active,
  warn,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 font-ui text-xs transition-colors",
        active
          ? "border-border-strong bg-text text-surface"
          : warn
            ? "border-danger/50 bg-surface text-danger hover:bg-danger/10"
            : "border-border bg-surface text-text hover:bg-surface2",
      )}
    >
      {label}
      {typeof count === "number" && (
        <span className={cn("ml-1", active ? "opacity-70" : "text-text2")}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function AutopilotConsole() {
  const [leads, setLeads] = useState<AutopilotLead[]>([]);
  const [stats, setStats] = useState<AutopilotStats | null>(null);
  const [alerts, setAlerts] = useState<AutopilotAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [view, setView] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("azione");
  const [tierFilter, setTierFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showAlerts, setShowAlerts] = useState(false);

  const [openLead, setOpenLead] = useState<AutopilotLead | null>(null);
  const [drawerFocus, setDrawerFocus] = useState<"chat" | undefined>();

  const refresh = useCallback(async () => {
    try {
      const [pipRes, alertsRes] = await Promise.all([
        fetch("/api/autopilot/pipeline", { cache: "no-store" }),
        fetch("/api/autopilot/alerts?unread=1", { cache: "no-store" }),
      ]);
      const pip = (await pipRes.json()) as ApiResponse<{
        leads: AutopilotLead[];
        stats: AutopilotStats;
      }>;
      const a = (await alertsRes.json()) as ApiResponse<AutopilotAlert[]>;
      if (pip.success && pip.data) {
        setLeads(pip.data.leads);
        setStats(pip.data.stats);
      }
      if (a.success && a.data) setAlerts(a.data);
      setError(null);
    } catch {
      setError("Errore di rete durante il refresh.");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Il drawer mostra sempre la versione più fresca del lead aperto.
  useEffect(() => {
    if (!openLead) return;
    const fresh = leads.find((l) => l.lead_id === openLead.lead_id);
    if (fresh && fresh !== openLead) setOpenLead(fresh);
  }, [leads, openLead]);

  const categories = useMemo(
    () => Array.from(new Set(leads.map((l) => l.category))).sort(),
    [leads],
  );

  const counts = useMemo(() => {
    const c = {} as Record<StatusFilter, number>;
    for (const f of STATUS_FILTERS) {
      c[f.id] = leads.filter((l) => matchesStatus(l, f.id)).length;
    }
    return c;
  }, [leads]);

  const visible = useMemo(() => {
    const filtered = leads.filter(
      (l) =>
        matchesStatus(l, statusFilter) &&
        (!tierFilter || l.tier === tierFilter) &&
        (!categoryFilter || l.category === categoryFilter),
    );
    if (statusFilter === "agenda") {
      return [...filtered].sort(
        (a, b) =>
          new Date(a.next_action_at ?? 0).getTime() -
          new Date(b.next_action_at ?? 0).getTime(),
      );
    }
    return sortByAction(filtered);
  }, [leads, statusFilter, tierFilter, categoryFilter]);

  // ----- azioni -----------------------------------------------

  async function patch(url: string, body: Record<string, unknown>, id: string) {
    setBusyId(id);
    try {
      await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  /** POST conversazione (log in/out, suggest, demo): ritorna il payload
   *  al drawer (lead aggiornato + eventuale bozza suggerita). */
  const conv = useCallback(
    async (
      leadId: string,
      payload: Record<string, unknown>,
    ): Promise<ConversationResult | null> => {
      setBusyId(leadId);
      try {
        const res = await fetch("/api/autopilot/conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: leadId, ...payload }),
        });
        const j = (await res.json()) as ApiResponse<ConversationResult>;
        await refresh();
        if (!j.success) {
          window.alert(`Errore: ${j.error ?? "sconosciuto"}`);
          return null;
        }
        return j.data ?? null;
      } catch {
        setError("Errore di rete durante l'azione conversazione.");
        return null;
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const archive = (leadId: string) =>
    patch("/api/autopilot/pipeline", { lead_id: leadId, action: "archive" }, leadId);
  const updateDealAction = (leadId: string, fields: Record<string, unknown>) =>
    patch(
      "/api/autopilot/pipeline",
      { lead_id: leadId, action: "update_deal", ...fields },
      leadId,
    );

  const logOutbound = (leadId: string, body: string) =>
    conv(leadId, { action: "log_outbound", body });
  const logInbound = (leadId: string, body: string) =>
    conv(leadId, { action: "log_inbound", body });
  const suggest = (leadId: string) => conv(leadId, { action: "suggest" });
  const markDemoSent = (leadId: string, demoUrl?: string) =>
    conv(leadId, { action: "mark_demo_sent", demo_url: demoUrl });

  /** Run di Study on-demand: stessa logica del cron (lotto da 10). */
  async function studyNow() {
    setBusyId("study");
    try {
      const res = await fetch("/api/autopilot/study", { method: "POST" });
      const j = (await res.json()) as ApiResponse<{
        studied: number;
        incomplete: number;
        failed: number;
        archived: number;
      }>;
      if (!j.success) {
        window.alert(`Errore study: ${j.error ?? "sconosciuto"}`);
        return;
      }
      const d = j.data;
      if (d && d.studied + d.incomplete + d.failed + (d.archived ?? 0) === 0) {
        window.alert("Nessun lead nuovo da studiare.");
      } else if (d && (d.failed > 0 || d.incomplete > 0 || (d.archived ?? 0) > 0)) {
        window.alert(
          `Study: ${d.studied} ok, ${d.archived ?? 0} archiviati (fisso), ${d.incomplete} da completare, ${d.failed} falliti (ritenta o aspetta il cron).`,
        );
      }
      await refresh();
    } catch {
      window.alert("Errore di rete durante lo study.");
    } finally {
      setBusyId(null);
    }
  }

  /** Import manuale dei lead Visor mai contattati. */
  async function importVisorLeads() {
    setBusyId("import");
    try {
      const res = await fetch("/api/autopilot/import", { cache: "no-store" });
      const j = (await res.json()) as ApiResponse<{
        eligible: number;
        sample: string[];
      }>;
      if (!j.success || !j.data) {
        window.alert(`Errore conteggio: ${j.error ?? "risposta non valida"}`);
        return;
      }
      if (j.data.eligible === 0) {
        window.alert("Nessun lead Visor eleggibile (mai contattati, con telefono, non già in pipeline).");
        return;
      }
      const sample = j.data.sample.join(", ");
      if (
        !window.confirm(
          `${j.data.eligible} lead Visor eleggibili (es. ${sample}).\n\nImportarli in Autopilot? Lo study li preparerà a lotti nei prossimi giorni.`,
        )
      ) {
        return;
      }
      const post = await fetch("/api/autopilot/import", { method: "POST" });
      const pj = (await post.json()) as ApiResponse<{ imported: number }>;
      window.alert(
        pj.success
          ? `Importati ${pj.data?.imported ?? 0} lead in pipeline (stato "nuovo").`
          : `Errore import: ${pj.error ?? "sconosciuto"}`,
      );
      await refresh();
    } catch {
      window.alert("Errore di rete durante l'import.");
    } finally {
      setBusyId(null);
    }
  }

  async function clearAlerts() {
    await fetch("/api/autopilot/alerts", { method: "PATCH" });
    setShowAlerts(false);
    refresh();
  }

  function openDrawer(lead: AutopilotLead, tab?: "chat") {
    setDrawerFocus(tab);
    setOpenLead(lead);
  }

  const trattativeCount = stats
    ? (stats.by_stage.da_chiamare ?? 0) +
      (stats.by_stage.demo_richiesta ?? 0) +
      (stats.by_stage.demo_inviata ?? 0) +
      (stats.by_stage.richiesta_prezzo ?? 0) +
      (stats.by_stage.in_trattativa ?? 0) +
      (stats.by_stage.tiepido ?? 0)
    : null;

  // ----- render -----------------------------------------------

  return (
    <div className="space-y-4">
      {error && (
        <p className="font-ui text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      {/* topbar compatta: toggle vista + contatori + alert + azioni */}
      <GlassCard className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
        <div className="flex overflow-hidden rounded-sm border border-border">
          {(
            [
              { id: "list", label: "Lista", icon: List },
              { id: "kanban", label: "Kanban", icon: Columns3 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 font-ui text-[11px] uppercase tracking-[0.1em] transition-colors",
                view === id ? "bg-text text-surface" : "text-text2 hover:text-text",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <p className="font-ui text-xs text-text2">
          Da contattare{" "}
          <b className="text-sm text-text">
            {stats ? (stats.by_stage.studiato ?? 0) : "—"}
          </b>
        </p>
        <p className="hidden font-ui text-xs text-text2 sm:block">
          Contattati{" "}
          <b className="text-sm text-text">
            {stats ? (stats.by_stage.contattato ?? 0) : "—"}
          </b>
        </p>
        <p className="hidden font-ui text-xs text-text2 md:block">
          Trattative <b className="text-sm text-text">{trattativeCount ?? "—"}</b>
          {" · "}Vinti{" "}
          <b className="text-sm text-success">{stats ? (stats.by_stage.vinto ?? 0) : "—"}</b>
        </p>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={busyId === "study"}
            onClick={studyNow}
            className="flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 font-ui text-xs text-text2 transition-colors hover:text-text disabled:opacity-40"
          >
            <BookOpen
              className={cn("h-3.5 w-3.5", busyId === "study" && "animate-pulse")}
            />
            <span className="hidden sm:inline">
              {busyId === "study" ? "Studiando…" : "Studia ora"}
            </span>
          </button>
          <button
            type="button"
            disabled={busyId === "import"}
            onClick={importVisorLeads}
            className="flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 font-ui text-xs text-text2 transition-colors hover:text-text disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {busyId === "import" ? "Importo…" : "Importa da Visor"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowAlerts((s) => !s)}
            className={cn(
              "relative flex items-center gap-1 rounded-sm border border-border px-2 py-1.5 font-ui text-xs",
              alerts.length > 0 ? "text-ochre" : "text-text2",
            )}
            aria-label="Notifiche"
          >
            <Bell className="h-3.5 w-3.5" />
            {alerts.length > 0 && alerts.length}
          </button>
        </div>
      </GlassCard>

      {showAlerts && (
        <GlassCard className="p-4" glow="amber">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-ochre">
              Notifiche non lette
            </h2>
            {alerts.length > 0 && (
              <button
                type="button"
                onClick={clearAlerts}
                className="font-ui text-xs text-accent hover:underline"
              >
                Segna lette
              </button>
            )}
          </div>
          {alerts.length === 0 ? (
            <p className="font-ui text-xs text-text2">Tutto letto.</p>
          ) : (
            <ul className="space-y-1">
              {alerts.slice(0, 10).map((a) => (
                <li key={a.id} className="font-ui text-sm text-text">
                  <span
                    className={cn(
                      "mr-2 font-ui text-[10px] uppercase",
                      a.type === "escalation" || a.type === "anomaly"
                        ? "text-danger"
                        : "text-accent",
                    )}
                  >
                    {a.type}
                  </span>
                  {a.message}
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      )}

      {/* filtri a chip */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
            Stato
          </span>
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              count={counts[f.id]}
              active={statusFilter === f.id}
              warn={f.id === "escalation" && counts.escalation > 0}
              onClick={() => setStatusFilter(f.id)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
            Tier
          </span>
          {["T1", "T2", "T3"].map((t) => (
            <Chip
              key={t}
              label={t}
              active={tierFilter === t}
              onClick={() => setTierFilter((cur) => (cur === t ? null : t))}
            />
          ))}
          {categories.length > 0 && (
            <>
              <span className="ml-3 w-auto font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
                Categoria
              </span>
              {categories.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  active={categoryFilter === c}
                  onClick={() => setCategoryFilter((cur) => (cur === c ? null : c))}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* lista / kanban */}
      {view === "kanban" ? (
        <AutopilotKanban leads={visible} onOpen={openDrawer} />
      ) : visible.length === 0 ? (
        <GlassCard className="px-6 py-10 text-center">
          <p className="font-ui text-sm text-text2">{EMPTY_STATES[statusFilter]}</p>
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <ul>
            {visible.map((l) => (
              <AutopilotLeadRow
                key={l.lead_id}
                lead={l}
                busy={busyId === l.lead_id}
                onOpen={openDrawer}
                onArchive={archive}
              />
            ))}
          </ul>
        </GlassCard>
      )}

      <AutopilotLeadDrawer
        lead={openLead}
        focus={drawerFocus}
        busy={busyId === openLead?.lead_id}
        onClose={() => setOpenLead(null)}
        onArchive={archive}
        onUpdateDeal={updateDealAction}
        onLogOutbound={logOutbound}
        onLogInbound={logInbound}
        onSuggest={suggest}
        onMarkDemoSent={markDemoSent}
      />
    </div>
  );
}
