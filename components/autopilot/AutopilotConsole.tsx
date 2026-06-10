"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ExternalLink,
  Pause,
  Play,
  XCircle,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type {
  AutopilotAlert,
  AutopilotBuild,
  AutopilotLead,
  AutopilotStage,
  AutopilotStats,
} from "@/types/autopilot";

// ============================================================
// AUTOPILOT console — pipeline view (6 stadi), contatore
// outreach giornaliero, coda messaggi da approvare, demo da
// approvare e kill switch globale. Poll ogni 30s.
// ============================================================

const STAGE_LABELS: Record<AutopilotStage, string> = {
  nuovo: "Nuovo",
  studiato: "Studiato",
  contattato: "Contattato",
  demo_richiesta: "Demo richiesta",
  escalation: "Escalation",
  archiviato: "Archiviato",
};

const STAGE_ORDER: AutopilotStage[] = [
  "nuovo",
  "studiato",
  "contattato",
  "demo_richiesta",
  "escalation",
  "archiviato",
];

const STAGE_ACCENT: Record<AutopilotStage, string> = {
  nuovo: "text-text2 border-border",
  studiato: "text-accent border-accent/40",
  contattato: "text-ochre border-ochre/40",
  demo_richiesta: "text-success border-success/40",
  escalation: "text-danger border-danger/40",
  archiviato: "text-text2 border-border",
};

const TIER_BADGE: Record<string, string> = {
  T1: "border-success/50 text-success",
  T2: "border-ochre/50 text-ochre",
  T3: "border-border text-text2",
};

interface PipelinePayload {
  leads: AutopilotLead[];
  stats: AutopilotStats;
}

export default function AutopilotConsole() {
  const [leads, setLeads] = useState<AutopilotLead[]>([]);
  const [stats, setStats] = useState<AutopilotStats | null>(null);
  const [queue, setQueue] = useState<AutopilotLead[]>([]);
  const [builds, setBuilds] = useState<AutopilotBuild[]>([]);
  const [alerts, setAlerts] = useState<AutopilotAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [pipRes, queueRes, buildsRes, alertsRes] = await Promise.all([
        fetch("/api/autopilot/pipeline", { cache: "no-store" }),
        fetch("/api/autopilot/queue", { cache: "no-store" }),
        fetch("/api/autopilot/builds", { cache: "no-store" }),
        fetch("/api/autopilot/alerts?unread=1", { cache: "no-store" }),
      ]);
      const pip = (await pipRes.json()) as ApiResponse<PipelinePayload>;
      const q = (await queueRes.json()) as ApiResponse<AutopilotLead[]>;
      const b = (await buildsRes.json()) as ApiResponse<AutopilotBuild[]>;
      const a = (await alertsRes.json()) as ApiResponse<AutopilotAlert[]>;
      if (pip.success && pip.data) {
        setLeads(pip.data.leads);
        setStats(pip.data.stats);
      }
      if (q.success && q.data) setQueue(q.data);
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

  const byStage = useMemo(() => {
    const map = new Map<AutopilotStage, AutopilotLead[]>();
    for (const s of STAGE_ORDER) map.set(s, []);
    for (const l of leads) map.get(l.stage)?.push(l);
    return map;
  }, [leads]);

  async function toggleKillSwitch() {
    if (!stats) return;
    const next = !stats.kill_switch;
    if (
      next &&
      !window.confirm("Attivare il KILL SWITCH? Ferma outreach e bot su tutte le chat.")
    ) {
      return;
    }
    await fetch("/api/autopilot/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kill_switch: next }),
    });
    refresh();
  }

  async function decide(leadId: string, action: "approve" | "reject") {
    setBusyId(leadId);
    try {
      await fetch("/api/autopilot/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          action,
          message: drafts[leadId],
        }),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function approveDemo(buildId: string) {
    setBusyId(buildId);
    try {
      await fetch("/api/autopilot/builds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ build_id: buildId, action: "approve" }),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function clearAlerts() {
    await fetch("/api/autopilot/alerts", { method: "PATCH" });
    refresh();
  }

  const demosToApprove = builds.filter((b) => b.status === "deployed");

  return (
    <div className="space-y-6">
      {error && (
        <p className="font-mono text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      {/* ---- Barra stato: contatore outreach + warm-up + kill switch ---- */}
      <GlassCard className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-text2">
            Outreach oggi
          </p>
          <p className="font-display text-2xl font-bold text-text">
            {stats ? `${stats.today.new_contacts} / ${stats.daily_cap}` : "—"}
            <span className="ml-2 font-mono text-xs font-normal text-text2">
              nuovi contatti
            </span>
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-text2">
            Messaggi inviati
          </p>
          <p className="font-display text-2xl font-bold text-text">
            {stats ? stats.today.messages_sent : "—"}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-text2">
            Fase
          </p>
          <p
            className={cn(
              "font-mono text-sm",
              stats?.warmup_active ? "text-ochre" : "text-success",
            )}
          >
            {stats?.warmup_active ? "WARM-UP (review manuale)" : "REGIME (auto)"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {alerts.length > 0 && (
            <button
              type="button"
              onClick={clearAlerts}
              className="flex items-center gap-1 font-mono text-xs text-ochre hover:text-text"
              title="Segna notifiche come lette"
            >
              <Bell className="h-4 w-4" /> {alerts.length}
            </button>
          )}
          <NeonButton
            size="sm"
            variant={stats?.kill_switch ? "green" : "magenta"}
            filled={stats?.kill_switch ?? false}
            onClick={toggleKillSwitch}
          >
            {stats?.kill_switch ? (
              <>
                <Play className="h-3.5 w-3.5" /> Riattiva pipeline
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
        <p className="flex items-center gap-2 font-mono text-xs text-danger">
          <AlertTriangle className="h-4 w-4" />
          KILL SWITCH ATTIVO: nessun invio, bot fermo su tutte le chat.
        </p>
      )}

      {/* ---- Notifiche non lette ---- */}
      {alerts.length > 0 && (
        <GlassCard className="p-4" glow="amber">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-ochre">
            Notifiche
          </h2>
          <ul className="space-y-1">
            {alerts.slice(0, 8).map((a) => (
              <li key={a.id} className="font-ui text-sm text-text">
                <span
                  className={cn(
                    "mr-2 font-mono text-[10px] uppercase",
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
        </GlassCard>
      )}

      {/* ---- Coda messaggi da approvare ---- */}
      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-accent">
          Coda da approvare ({queue.length})
        </h2>
        {queue.length === 0 ? (
          <p className="font-ui text-sm text-text2">
            Nessun messaggio in attesa di review.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {queue.map((l) => (
              <GlassCard key={l.lead_id} className="p-4" glow="cyan">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-sm border px-1.5 py-0.5 font-mono text-[10px]",
                      TIER_BADGE[l.tier] ?? TIER_BADGE.T3,
                    )}
                  >
                    {l.tier}
                  </span>
                  <span className="font-display text-sm font-bold text-text">
                    {l.company}
                  </span>
                  <span className="font-mono text-xs text-text2">
                    {l.city} · {l.rating.toFixed(1)}★ ({l.reviews})
                  </span>
                </div>
                {l.brief && (
                  <p className="mb-2 whitespace-pre-line font-ui text-xs text-text2">
                    {l.brief}
                  </p>
                )}
                <textarea
                  className="mb-3 w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                  rows={4}
                  value={drafts[l.lead_id] ?? l.wa_first_message}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [l.lead_id]: e.target.value }))
                  }
                />
                <div className="flex gap-2">
                  <NeonButton
                    size="sm"
                    variant="green"
                    disabled={busyId === l.lead_id}
                    onClick={() => decide(l.lead_id, "approve")}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approva
                  </NeonButton>
                  <NeonButton
                    size="sm"
                    variant="magenta"
                    disabled={busyId === l.lead_id}
                    onClick={() => decide(l.lead_id, "reject")}
                  >
                    <XCircle className="h-3.5 w-3.5" /> Scarta
                  </NeonButton>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      {/* ---- Demo da approvare ---- */}
      {demosToApprove.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-success">
            Demo pronte — approvazione prima dell&apos;invio (
            {demosToApprove.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {demosToApprove.map((b) => {
              const lead = leads.find((l) => l.lead_id === b.lead_id);
              return (
                <GlassCard key={b.id} className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-bold text-text">
                      {lead?.company ?? b.lead_id}
                    </p>
                    <p className="font-mono text-xs text-text2">
                      template: {b.template || "—"}
                    </p>
                    {b.preview_url && (
                      <a
                        href={b.preview_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline"
                      >
                        {b.preview_url} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <NeonButton
                    size="sm"
                    variant="green"
                    disabled={busyId === b.id}
                    onClick={() => approveDemo(b.id)}
                  >
                    Approva e invia
                  </NeonButton>
                </GlassCard>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- Pipeline view ---- */}
      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-text2">
          Pipeline
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {STAGE_ORDER.map((stage) => {
            const items = byStage.get(stage) ?? [];
            return (
              <GlassCard key={stage} className="flex flex-col p-3">
                <div
                  className={cn(
                    "mb-2 flex items-center justify-between border-b pb-2",
                    STAGE_ACCENT[stage],
                  )}
                >
                  <span className="font-mono text-[10px] uppercase tracking-widest">
                    {STAGE_LABELS[stage]}
                  </span>
                  <span className="font-display text-sm font-bold">
                    {stats?.by_stage[stage] ?? items.length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {items.slice(0, 8).map((l) => (
                    <li key={l.lead_id} className="font-ui text-xs">
                      <span className="block truncate font-medium text-text">
                        {l.company}
                      </span>
                      <span className="font-mono text-[10px] text-text2">
                        {l.tier} · {l.city}
                        {stage === "escalation" && l.escalation_reason
                          ? ` · ${l.escalation_reason}`
                          : ""}
                      </span>
                    </li>
                  ))}
                  {items.length > 8 && (
                    <li className="font-mono text-[10px] text-text2">
                      +{items.length - 8} altri
                    </li>
                  )}
                </ul>
              </GlassCard>
            );
          })}
        </div>
      </section>
    </div>
  );
}
