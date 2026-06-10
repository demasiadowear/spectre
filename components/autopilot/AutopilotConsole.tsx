"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Columns3,
  Download,
  List,
  Pause,
  Play,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type {
  AutopilotAlert,
  AutopilotBuild,
  AutopilotLead,
  AutopilotStats,
} from "@/types/autopilot";
import AutopilotKanban from "./AutopilotKanban";
import AutopilotLeadDrawer from "./AutopilotLeadDrawer";
import AutopilotLeadRow from "./AutopilotLeadRow";
import {
  actionPriority,
  isPendingApproval,
  latestBuild,
  queuedSendLabels,
  sortByAction,
} from "./format";

// ============================================================
// AUTOPILOT console — lista compatta (default) con ordinamento
// "richiede azione", filtri a chip, drawer di dettaglio, kanban
// come vista alternativa, contatore outreach e kill switch.
// Poll ogni 30s.
// ============================================================

type ViewMode = "list" | "kanban";

type StatusFilter =
  | "azione"
  | "tutti"
  | "escalation"
  | "da_approvare"
  | "demo"
  | "contattati"
  | "nuovi"
  | "archiviati";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "azione", label: "Richiede azione" },
  { id: "tutti", label: "Tutti" },
  { id: "escalation", label: "Escalation" },
  { id: "da_approvare", label: "Da approvare" },
  { id: "demo", label: "Demo" },
  { id: "contattati", label: "Contattati" },
  { id: "nuovi", label: "Nuovi" },
  { id: "archiviati", label: "Archiviati" },
];

const EMPTY_STATES: Record<StatusFilter, string> = {
  azione: "Niente da fare adesso — l'autopilot lavora da solo.",
  tutti: "Nessun lead in pipeline. Lo scout gira ogni mattina alle 6.",
  escalation: "Nessuna escalation aperta.",
  da_approvare: "Nessun lead da approvare oggi — la coda è pulita.",
  demo: "Nessuna demo in corso.",
  contattati: "Nessun lead contattato in attesa.",
  nuovi: "Nessun lead nuovo: lo study li ha già processati tutti.",
  archiviati: "Archivio vuoto.",
};

function matchesStatus(lead: AutopilotLead, f: StatusFilter): boolean {
  switch (f) {
    case "azione":
      return actionPriority(lead) < 3;
    case "tutti":
      return true;
    case "escalation":
      return lead.stage === "escalation";
    case "da_approvare":
      return isPendingApproval(lead);
    case "demo":
      return lead.stage === "demo_richiesta";
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
  const [builds, setBuilds] = useState<AutopilotBuild[]>([]);
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
      const [pipRes, buildsRes, alertsRes] = await Promise.all([
        fetch("/api/autopilot/pipeline", { cache: "no-store" }),
        fetch("/api/autopilot/builds", { cache: "no-store" }),
        fetch("/api/autopilot/alerts?unread=1", { cache: "no-store" }),
      ]);
      const pip = (await pipRes.json()) as ApiResponse<{
        leads: AutopilotLead[];
        stats: AutopilotStats;
      }>;
      const b = (await buildsRes.json()) as ApiResponse<AutopilotBuild[]>;
      const a = (await alertsRes.json()) as ApiResponse<AutopilotAlert[]>;
      if (pip.success && pip.data) {
        setLeads(pip.data.leads);
        setStats(pip.data.stats);
      }
      if (b.success && b.data) setBuilds(b.data);
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

  // ETA invio per i lead approvati in attesa (solo UI, ricalcolata a
  // ogni refresh/poll 30s).
  const queuedLabels = useMemo(
    () => queuedSendLabels(leads, stats?.kill_switch ?? false),
    [leads, stats?.kill_switch],
  );

  const counts = useMemo(() => {
    const c = {} as Record<StatusFilter, number>;
    for (const f of STATUS_FILTERS) {
      c[f.id] = leads.filter((l) => matchesStatus(l, f.id)).length;
    }
    return c;
  }, [leads]);

  const visible = useMemo(
    () =>
      sortByAction(
        leads.filter(
          (l) =>
            matchesStatus(l, statusFilter) &&
            (!tierFilter || l.tier === tierFilter) &&
            (!categoryFilter || l.category === categoryFilter),
        ),
      ),
    [leads, statusFilter, tierFilter, categoryFilter],
  );

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

  const approve = (leadId: string, message?: string) =>
    patch("/api/autopilot/queue", { lead_id: leadId, action: "approve", message }, leadId);
  const reject = (leadId: string) =>
    patch("/api/autopilot/queue", { lead_id: leadId, action: "reject" }, leadId);
  const archive = (leadId: string) =>
    patch("/api/autopilot/pipeline", { lead_id: leadId, action: "archive" }, leadId);
  const approveDemo = (buildId: string) =>
    patch("/api/autopilot/builds", { build_id: buildId, action: "approve" }, buildId);

  async function toggleKillSwitch() {
    if (!stats) return;
    const next = !stats.kill_switch;
    if (
      next &&
      !window.confirm("Attivare il KILL SWITCH? Ferma outreach e bot su tutte le chat.")
    ) {
      return;
    }
    await patch("/api/autopilot/settings", { kill_switch: next }, "kill");
  }

  /** Run di Study on-demand: stessa logica del cron (lotto da 10),
   *  dietro auth sessione. La UI disabilita il pulsante a run in corso. */
  async function studyNow() {
    setBusyId("study");
    try {
      const res = await fetch("/api/autopilot/study", { method: "POST" });
      const j = (await res.json()) as ApiResponse<{
        studied: number;
        incomplete: number;
        failed: number;
      }>;
      if (!j.success) {
        window.alert(`Errore study: ${j.error ?? "sconosciuto"}`);
        return;
      }
      const d = j.data;
      if (d && d.studied + d.incomplete + d.failed === 0) {
        window.alert("Nessun lead nuovo da studiare.");
      } else if (d && (d.failed > 0 || d.incomplete > 0)) {
        window.alert(
          `Study: ${d.studied} ok, ${d.incomplete} da completare, ${d.failed} falliti (ritenta o aspetta il cron).`,
        );
      }
      await refresh();
    } catch {
      window.alert("Errore di rete durante lo study.");
    } finally {
      setBusyId(null);
    }
  }

  /** Import manuale dei lead Visor mai contattati: prima il conteggio
   *  eleggibili, poi conferma e import in batch (stage "nuovo"). */
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
          `${j.data.eligible} lead Visor eleggibili (es. ${sample}).\n\nImportarli in Autopilot? Lo study li processerà a lotti nei prossimi giorni, entro i cap giornalieri.`,
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

  // ----- render -----------------------------------------------

  return (
    <div className="space-y-4">
      {error && (
        <p className="font-ui text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      {/* topbar compatta: toggle vista + contatori + alert + kill switch */}
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
                view === id
                  ? "bg-text text-surface"
                  : "text-text2 hover:text-text",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <p className="font-ui text-xs text-text2">
          Outreach oggi{" "}
          <b className="text-sm text-text">
            {stats ? `${stats.today.new_contacts}/${stats.daily_cap}` : "—"}
          </b>
        </p>
        <p className="hidden font-ui text-xs text-text2 sm:block">
          Inviati <b className="text-sm text-text">{stats?.today.messages_sent ?? "—"}</b>
        </p>
        <p
          className={cn(
            "font-ui text-[11px] uppercase tracking-[0.1em]",
            stats?.warmup_active ? "text-ochre" : "text-success",
          )}
        >
          {stats?.warmup_active ? "Warm-up" : "Regime"}
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
          <NeonButton
            size="sm"
            variant={stats?.kill_switch ? "green" : "magenta"}
            filled={stats?.kill_switch ?? false}
            onClick={toggleKillSwitch}
          >
            {stats?.kill_switch ? (
              <>
                <Play className="h-3.5 w-3.5" /> Riattiva
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" /> Kill switch
              </>
            )}
          </NeonButton>
        </div>
      </GlassCard>

      {stats?.kill_switch && (
        <p className="flex items-center gap-2 font-ui text-xs text-danger">
          <AlertTriangle className="h-4 w-4" />
          KILL SWITCH ATTIVO: nessun invio, bot fermo su tutte le chat.
        </p>
      )}

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
                  onClick={() =>
                    setCategoryFilter((cur) => (cur === c ? null : c))
                  }
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* lista / kanban */}
      {view === "kanban" ? (
        <AutopilotKanban leads={visible} queuedLabels={queuedLabels} onOpen={openDrawer} />
      ) : visible.length === 0 ? (
        <GlassCard className="px-6 py-10 text-center">
          <p className="font-ui text-sm text-text2">
            {EMPTY_STATES[statusFilter]}
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <ul>
            {visible.map((l) => (
              <AutopilotLeadRow
                key={l.lead_id}
                lead={l}
                queuedLabel={queuedLabels.get(l.lead_id) ?? null}
                build={latestBuild(l, builds)}
                busy={busyId === l.lead_id}
                onOpen={openDrawer}
                onApprove={(id) => approve(id)}
                onReject={reject}
                onArchive={archive}
                onApproveDemo={approveDemo}
              />
            ))}
          </ul>
        </GlassCard>
      )}

      <AutopilotLeadDrawer
        lead={openLead}
        build={openLead ? latestBuild(openLead, builds) : null}
        focus={drawerFocus}
        busy={busyId === openLead?.lead_id}
        onClose={() => setOpenLead(null)}
        onApprove={approve}
        onReject={reject}
        onArchive={archive}
        onApproveDemo={approveDemo}
      />
    </div>
  );
}
