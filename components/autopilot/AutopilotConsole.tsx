"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BookOpen, Columns3, Download, List, Map as MapIcon } from "lucide-react";
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
import PipelineMap from "./PipelineMap";
import {
  actionPriority,
  isRecent,
  parseDbDate,
  sortByAction,
  sortByQuality,
} from "./format";

// ============================================================
// AUTOPILOT console — copilota MANUALE. Scout+Study trovano e
// preparano i lead; Puccio contatta a mano (wa.me), incolla le
// risposte, SPECTRE le smista e suggerisce. Nessun worker, nessun
// invio automatico. Poll ogni 30s.
// ============================================================

type ViewMode = "list" | "kanban" | "mappa";

type StatusFilter =
  | "azione"
  | "agenda"
  | "recent"
  | "tutti"
  | "da_contattare"
  | "contattati"
  | "risposti"
  | "trattative"
  | "chiusi"
  | "archiviati";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "azione", label: "Cosa fare ora" },
  { id: "agenda", label: "Agenda" },
  { id: "tutti", label: "Tutti" },
  { id: "da_contattare", label: "Da contattare" },
  { id: "contattati", label: "Contattati" },
  { id: "risposti", label: "Ha risposto" },
  { id: "trattative", label: "In trattativa" },
  { id: "chiusi", label: "Vinti / Persi" },
  { id: "archiviati", label: "Archiviati" },
];

const EMPTY_STATES: Record<StatusFilter, string> = {
  azione: "Niente da fare adesso. Lo scout gira ogni mattina alle 6.",
  agenda: "Nessuna azione pianificata: fissa data e prossima azione dal dettaglio lead.",
  recent: "Nessun lead aggiunto di recente.",
  tutti: "Nessun lead in pipeline. Lo scout gira ogni mattina alle 6.",
  da_contattare: "Nessun lead pronto da contattare: lo study li sta preparando.",
  contattati: "Nessun lead contattato in attesa di risposta.",
  risposti: "Nessuna risposta da gestire.",
  trattative: "Nessuna trattativa aperta.",
  chiusi: "Ancora nessun vinto o perso.",
  archiviati: "Archivio vuoto.",
};

// REGOLA: ogni lead DEVE matchare almeno un filtro oltre a "tutti".
function matchesStatus(lead: AutopilotLead, f: StatusFilter): boolean {
  switch (f) {
    case "azione":
      return actionPriority(lead) < 3;
    case "agenda":
      return Boolean(lead.next_action_at) && lead.stage !== "archiviato" && lead.stage !== "perso";
    case "recent":
      return isRecent(lead);
    case "tutti":
      return true;
    case "da_contattare":
      return lead.stage === "da_contattare";
    case "contattati":
      return lead.stage === "contattato";
    case "risposti":
      return lead.stage === "ha_risposto";
    case "trattative":
      return lead.stage === "in_trattativa";
    case "chiusi":
      return lead.stage === "vinto" || lead.stage === "perso";
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
  const [sortMode, setSortMode] = useState<"azione" | "qualita">("azione");
  const [waOnly, setWaOnly] = useState(false);
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

  // Filtri trasversali (categoria, solo WhatsApp) applicati PRIMA dei
  // chip di stato: senza questo, i numeri sui chip contavano su tutti
  // i lead mentre "visible" filtrava anche per categoria/waOnly, e il
  // numero sul chip non coincideva con le righe mostrate cliccandolo.
  const crossFiltered = useMemo(
    () =>
      leads.filter(
        (l) =>
          (!categoryFilter || l.category === categoryFilter) &&
          (!waOnly || l.phone_type === "mobile"),
      ),
    [leads, categoryFilter, waOnly],
  );

  const counts = useMemo(() => {
    const c = {} as Record<StatusFilter, number>;
    for (const f of STATUS_FILTERS) {
      c[f.id] = crossFiltered.filter((l) => matchesStatus(l, f.id)).length;
    }
    return c;
  }, [crossFiltered]);

  const visible = useMemo(() => {
    const filtered = crossFiltered.filter((l) => matchesStatus(l, statusFilter));
    if (statusFilter === "agenda") {
      return [...filtered].sort(
        (a, b) =>
          new Date(a.next_action_at ?? 0).getTime() -
          new Date(b.next_action_at ?? 0).getTime(),
      );
    }
    // "Recenti": ultimi aggiunti in cima, a prescindere dallo stato.
    if (statusFilter === "recent") {
      return [...filtered].sort(
        (a, b) =>
          (parseDbDate(b.created_at)?.getTime() ?? 0) -
          (parseDbDate(a.created_at)?.getTime() ?? 0),
      );
    }
    return sortMode === "qualita" ? sortByQuality(filtered) : sortByAction(filtered);
  }, [crossFiltered, statusFilter, sortMode]);

  // Chip "Recenti" mostrato solo se c'è davvero qualcosa di fresco (es.
  // dopo un import dall'Hunter), così di norma non ingombra la barra.
  // Sugli stessi lead scoperti dai filtri trasversali, per coerenza col
  // numero che poi si vede cliccandolo.
  const recentCount = useMemo(
    () => crossFiltered.filter((l) => isRecent(l)).length,
    [crossFiltered],
  );

  // ----- azioni -----------------------------------------------

  /** PATCH generico (archive/update_deal): controlla SEMPRE l'esito.
   *  Senza questo, un errore server (validazione, DB) passava inosservato
   *  — l'utente credeva di aver archiviato/salvato la trattativa mentre
   *  il server non aveva cambiato nulla. */
  async function patch(
    url: string,
    body: Record<string, unknown>,
    id: string,
  ): Promise<boolean> {
    setBusyId(id);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as ApiResponse<unknown>;
      await refresh();
      if (!j.success) {
        window.alert(`Errore: ${j.error ?? "operazione non riuscita"}`);
        return false;
      }
      return true;
    } catch {
      window.alert("Errore di rete: l'azione potrebbe non essere stata salvata.");
      return false;
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
  const setPrice = (leadId: string, price: number | null) =>
    conv(leadId, { action: "set_price", price });

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
        fisso: number;
      }>;
      if (!j.success) {
        window.alert(`Errore study: ${j.error ?? "sconosciuto"}`);
        return;
      }
      const d = j.data;
      const tot = d ? d.studied + d.incomplete + d.failed + (d.archived ?? 0) + (d.fisso ?? 0) : 0;
      if (d && tot === 0) {
        window.alert("Nessun lead nuovo da preparare.");
      } else if (d && (d.failed > 0 || d.incomplete > 0 || (d.archived ?? 0) > 0 || (d.fisso ?? 0) > 0)) {
        window.alert(
          `Study: ${d.studied} pronti, ${d.fisso ?? 0} fissi (da chiamare), ${d.archived ?? 0} archiviati, ${d.incomplete} da completare, ${d.failed} falliti.`,
        );
      }
      await refresh();
    } catch {
      window.alert("Errore di rete durante lo study.");
    } finally {
      setBusyId(null);
    }
  }

  /** Import manuale dei lead esistenti mai contattati. Riporta anche
   *  quanti sono stati saltati e perché (fisso/duplicato/callback):
   *  senza questo, un lotto Hunter di soli numeri fissi importa 0 lead
   *  e sembra che il pulsante non funzioni. */
  async function importVisorLeads() {
    setBusyId("import");
    try {
      const res = await fetch("/api/autopilot/import", { cache: "no-store" });
      const j = (await res.json()) as ApiResponse<{
        eligible: number;
        sample: string[];
        skipped_fisso: number;
        skipped_duplicate: number;
        skipped_callback: number;
      }>;
      if (!j.success || !j.data) {
        window.alert(`Errore conteggio: ${j.error ?? "risposta non valida"}`);
        return;
      }
      const skippedNote = (d: {
        skipped_fisso: number;
        skipped_duplicate: number;
        skipped_callback: number;
      }) => {
        const parts: string[] = [];
        if (d.skipped_fisso > 0)
          parts.push(`${d.skipped_fisso} con numero fisso (restano in Visor)`);
        if (d.skipped_duplicate > 0)
          parts.push(`${d.skipped_duplicate} già in pipeline`);
        if (d.skipped_callback > 0)
          parts.push(`${d.skipped_callback} con callback pianificato`);
        return parts.length > 0 ? `\nSaltati: ${parts.join(", ")}.` : "";
      };
      if (j.data.eligible === 0) {
        window.alert(
          `Nessun lead eleggibile da importare.${skippedNote(j.data)}`,
        );
        return;
      }
      const sample = j.data.sample.join(", ");
      if (
        !window.confirm(
          `${j.data.eligible} lead eleggibili (es. ${sample}).${skippedNote(j.data)}\n\nImportarli in Pipeline? Lo study li preparerà a lotti nei prossimi giorni.`,
        )
      ) {
        return;
      }
      const post = await fetch("/api/autopilot/import", { method: "POST" });
      const pj = (await post.json()) as ApiResponse<{
        imported: number;
        skipped_fisso: number;
        skipped_duplicate: number;
        skipped_callback: number;
      }>;
      if (!pj.success || !pj.data) {
        window.alert(`Errore import: ${pj.error ?? "sconosciuto"}`);
        return;
      }
      window.alert(
        `Importati ${pj.data.imported} lead in pipeline (stato "da contattare").${skippedNote(pj.data)}`,
      );
      // Salta subito sul filtro "Recenti": altrimenti i lead appena
      // importati (senza messaggio pronto) restano nascosti dalla
      // vista di default "Cosa fare ora" e sembra che l'import sia
      // andato a vuoto.
      if (pj.data.imported > 0) setStatusFilter("recent");
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

  const trattativeCount = stats ? (stats.by_stage.in_trattativa ?? 0) : null;

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
              { id: "mappa", label: "Mappa", icon: MapIcon },
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
            {stats ? (stats.by_stage.da_contattare ?? 0) : "—"}
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
              {busyId === "import" ? "Importo…" : "Importa lead"}
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
          {(recentCount > 0 || statusFilter === "recent") && (
            <Chip
              label="🆕 Recenti"
              count={recentCount}
              active={statusFilter === "recent"}
              onClick={() => setStatusFilter("recent")}
            />
          )}
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              count={counts[f.id]}
              active={statusFilter === f.id}
              onClick={() => setStatusFilter(f.id)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
            Ordina
          </span>
          <Chip
            label="Cosa fare ora"
            active={sortMode === "azione"}
            onClick={() => setSortMode("azione")}
          />
          <Chip
            label="Qualità ⭐"
            active={sortMode === "qualita"}
            onClick={() => setSortMode("qualita")}
          />
          <Chip
            label="📱 Solo WhatsApp"
            active={waOnly}
            onClick={() => setWaOnly((v) => !v)}
          />
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

      {/* lista / kanban / mappa */}
      {view === "mappa" ? (
        <PipelineMap leads={visible} onOpen={openDrawer} />
      ) : view === "kanban" ? (
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
        onSetPrice={setPrice}
      />
    </div>
  );
}
