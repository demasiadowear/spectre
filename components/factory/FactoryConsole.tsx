"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  ShieldQuestion,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import type { AgentJob, Followup, ForgeProject, JobStatus } from "@/types/factory";

// ============================================================
// Console operativa della Factory. Mostra tre cose, nell'ordine in cui
// servono davvero:
//  1. cosa sta facendo la coda (e perché: ogni job porta la sua ragione);
//  2. quali demo sono pronte da mandare;
//  3. cosa va ricontattato oggi.
//
// Il pulsante "prova" (dry-run) è il primo, non l'ultimo: prima si
// guarda cosa farebbe il worker, poi si lascia fare.
// ============================================================

interface JobsPayload {
  jobs: AgentJob[];
  counts: Record<JobStatus, number>;
}

interface WorkerRun {
  claimed: number;
  succeeded: number;
  failed: number;
  paused: boolean;
  skipped_limit: string[];
  recovered_leases: number;
  details: { job_id: string; kind: string; lead_id: string; outcome: string }[];
}

const EMPTY_COUNTS: Record<JobStatus, number> = {
  pending: 0,
  running: 0,
  waiting_approval: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
};

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "In attesa",
  running: "In corso",
  waiting_approval: "Da approvare",
  succeeded: "Fatti",
  failed: "Falliti",
  cancelled: "Annullati",
};

const STATUS_TONE: Record<JobStatus, string> = {
  pending: "text-text2",
  running: "text-accent",
  waiting_approval: "text-ochre",
  succeeded: "text-success",
  failed: "text-danger",
  cancelled: "text-text2",
};

const KIND_LABEL: Record<string, string> = {
  analyze_website: "Analisi sito",
  research_business: "Raccolta dati",
  generate_site: "Generazione bozza",
  run_site_qa: "Controllo qualità",
  prepare_outreach: "Messaggio da inviare",
  schedule_followup: "Promemoria",
};

/** Fasi in cui la demo si può già mostrare. */
const READY_STAGES = new Set(["ready", "outreach_ready"]);

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = (await res.json()) as { success: boolean; data?: T; error?: string };
  if (!json.success) throw new Error(json.error || "richiesta fallita");
  return json.data as T;
}

export default function FactoryConsole() {
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [counts, setCounts] = useState<Record<JobStatus, number>>(EMPTY_COUNTS);
  const [projects, setProjects] = useState<ForgeProject[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<WorkerRun | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [q, p, f] = await Promise.all([
        api<JobsPayload>("/api/factory/jobs?limit=60"),
        api<ForgeProject[]>("/api/factory/projects?limit=100"),
        api<Followup[]>("/api/factory/followups?open=1"),
      ]);
      setJobs(q.jobs);
      setCounts(q.counts);
      setProjects(p);
      setFollowups(f);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runWorker = useCallback(
    async (dryRun: boolean) => {
      setRunning(true);
      setError("");
      try {
        const res = await api<WorkerRun>("/api/factory/run", {
          method: "POST",
          body: JSON.stringify({ batch: 5, dry_run: dryRun }),
        });
        setLastRun(res);
        if (!dryRun) await load();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [load],
  );

  const cancel = useCallback(
    async (id: string) => {
      try {
        await api(`/api/factory/jobs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        await load();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [load],
  );

  const completeFollowup = useCallback(
    async (id: string) => {
      try {
        await api("/api/factory/followups", { method: "PATCH", body: JSON.stringify({ id }) });
        await load();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [load],
  );

  const markSent = useCallback(
    async (project: ForgeProject) => {
      try {
        await api("/api/factory/projects", {
          method: "PATCH",
          body: JSON.stringify({ id: project.id, lead_id: project.lead_id, stage: "sent" }),
        });
        await load();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [load],
  );

  const ready = useMemo(() => projects.filter((p) => READY_STAGES.has(p.stage)), [projects]);
  const failedQa = useMemo(() => projects.filter((p) => p.stage === "qa_failed"), [projects]);
  const liveJobs = useMemo(
    () => jobs.filter((j) => ["pending", "running", "waiting_approval"].includes(j.status)),
    [jobs],
  );

  if (loading) {
    return (
      <GlassCard className="flex items-center gap-2 p-6 font-ui text-sm text-text2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Caricamento stato Factory…
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <GlassCard className="flex items-start gap-2 border-danger/40 p-4 font-ui text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </GlassCard>
      ) : null}

      {/* ----- Comandi + stato coda ----- */}
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <NeonButton size="sm" variant="ghost" onClick={() => void runWorker(true)} disabled={running}>
            <ShieldQuestion className="h-3.5 w-3.5" aria-hidden />
            Prova senza eseguire
          </NeonButton>
          <NeonButton size="sm" filled onClick={() => void runWorker(false)} disabled={running}>
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden />
            )}
            Esegui 5 job
          </NeonButton>
          <NeonButton size="sm" variant="ghost" onClick={() => void load()} disabled={running}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Aggiorna
          </NeonButton>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => (
            <div key={s} className="rounded-sm border border-border px-3 py-2">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-text2">
                {STATUS_LABEL[s]}
              </dt>
              <dd className={cn("font-display text-xl font-bold", STATUS_TONE[s])}>
                {counts[s] ?? 0}
              </dd>
            </div>
          ))}
        </dl>

        {lastRun ? (
          <div className="mt-4 rounded-sm border border-border bg-bg/40 p-3 font-ui text-xs text-text2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-text2">
              Ultimo giro
            </p>
            {lastRun.paused ? (
              <p className="mt-1 text-ochre">
                Factory in pausa (FACTORY_PAUSED attiva): nessun job eseguito.
              </p>
            ) : (
              <p className="mt-1">
                presi {lastRun.claimed} · riusciti {lastRun.succeeded} · falliti {lastRun.failed}
                {lastRun.recovered_leases > 0 ? ` · recuperati ${lastRun.recovered_leases} lease scaduti` : ""}
              </p>
            )}
            {lastRun.skipped_limit.length > 0 ? (
              <p className="mt-1 text-ochre">
                Tetto giornaliero raggiunto per: {lastRun.skipped_limit.join(", ")}
              </p>
            ) : null}
            {lastRun.details.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {lastRun.details.map((d) => (
                  <li key={d.job_id}>
                    · {KIND_LABEL[d.kind] ?? d.kind}: {d.outcome}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </GlassCard>

      {/* ----- Demo pronte da mandare a mano ----- */}
      <GlassCard className="p-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
          / Demo pronte ({ready.length})
        </h2>
        {ready.length === 0 ? (
          <p className="mt-2 font-ui text-sm text-text2">
            Nessuna demo pronta. Il link lo mandi tu: la Factory prepara e si ferma qui.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {ready.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-ui text-sm text-text">
                    {p.spec?.business.name.value ?? p.lead_id}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-text2">
                    QA {p.qa_score}/100 · {p.stage === "outreach_ready" ? "messaggio pronto" : "da preparare"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.demo_url ? (
                    <a
                      href={p.demo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-accent hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      Apri
                    </a>
                  ) : null}
                  <NeonButton size="sm" variant="green" onClick={() => void markSent(p)}>
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    Inviata
                  </NeonButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* ----- QA non superato: serve una correzione a mano ----- */}
      {failedQa.length > 0 ? (
        <GlassCard className="border-ochre/40 p-4">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-ochre">
            / Bocciate dal controllo ({failedQa.length})
          </h2>
          <p className="mt-1 font-ui text-xs text-text2">
            Non vengono rigenerate da sole: rigenerare in loop brucerebbe quota senza cambiare
            il risultato.
          </p>
          <ul className="mt-3 space-y-2">
            {failedQa.map((p) => (
              <li key={p.id} className="rounded-sm border border-border px-3 py-2">
                <p className="font-ui text-sm text-text">
                  {p.spec?.business.name.value ?? p.lead_id}
                </p>
                <ul className="mt-1 space-y-0.5 font-ui text-xs text-text2">
                  {(p.qa_report?.checks ?? [])
                    .filter((c) => !c.passed)
                    .map((c) => (
                      <li key={c.code}>
                        · {c.blocking ? "blocca" : "minore"}: {c.label}
                        {c.detail ? ` — ${c.detail}` : ""}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : null}

      {/* ----- Coda viva: ogni job dice perché esiste ----- */}
      <GlassCard className="p-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
          / Coda ({liveJobs.length})
        </h2>
        {liveJobs.length === 0 ? (
          <p className="mt-2 font-ui text-sm text-text2">Coda vuota.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {liveJobs.map((j) => (
              <li
                key={j.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-sm border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-ui text-sm text-text">
                    {KIND_LABEL[j.kind] ?? j.kind}
                    <span className={cn("ml-2 font-mono text-[10px] uppercase tracking-widest", STATUS_TONE[j.status])}>
                      {STATUS_LABEL[j.status]}
                    </span>
                  </p>
                  {/* Il motivo è il punto: nessuna azione automatica opaca. */}
                  <p className="font-ui text-xs text-text2">{j.reason}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-text2">
                    tentativo {j.attempts}/{j.max_attempts} · dal {fmtDate(j.due_at)}
                    {j.error ? ` · ${j.error}` : ""}
                  </p>
                </div>
                <NeonButton size="sm" variant="magenta" onClick={() => void cancel(j.id)}>
                  <Ban className="h-3.5 w-3.5" aria-hidden />
                  Annulla
                </NeonButton>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* ----- Promemoria aperti ----- */}
      <GlassCard className="p-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
          / Da ricontattare ({followups.length})
        </h2>
        {followups.length === 0 ? (
          <p className="mt-2 font-ui text-sm text-text2">Nessun promemoria aperto.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {followups.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-ui text-sm text-text">{f.title}</p>
                  <p className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-text2">
                    <Clock className="h-3 w-3" aria-hidden />
                    {fmtDate(f.due_at)}
                    {f.note ? ` · ${f.note}` : ""}
                  </p>
                </div>
                <NeonButton size="sm" variant="ghost" onClick={() => void completeFollowup(f.id)}>
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Fatto
                </NeonButton>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
