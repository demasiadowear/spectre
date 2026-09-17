import { getPipelineLead } from "@/lib/autopilot/db";
import { getLeadById } from "@/lib/data";
import { turso } from "@/lib/turso";
import {
  ensureFactorySchema,
  getOrCreateProject,
  getProject,
  logActivity,
  proposeFact,
  saveProjectQa,
  saveProjectSpec,
  saveWebsiteAnalysis,
  scheduleFollowup,
  setFactoryStage,
  setProjectDemoUrl,
  setProjectStage,
} from "./db";
import { factsFromPlaces, generateSiteSpec } from "./generate";
import { prepareOutreach } from "./outreach";
import { qaSummary, runQa } from "./qa";
import {
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  jobsRunToday,
  recoverExpiredLeases,
} from "./queue";
import { analyzeWebsite, isEligible } from "./website";
import type { AgentJob, FactoryStage, JobKind } from "@/types/factory";

// ============================================================
// Orchestrazione Hunter → analisi → ricerca → generazione → QA →
// outreach preparato.
//
// Quattro freni, tutti attivi per default, perché questo codice spende
// soldi veri (Places, Gemini) e tocca lead veri:
//   1. `dry_run`: calcola e racconta, non scrive e non chiama;
//   2. batch massimo per giro;
//   3. limite giornaliero per tipo di job;
//   4. pausa globale via env (FACTORY_PAUSED).
//
// Il passo finale è `outreach_ready`, non `sent`: la Factory prepara,
// non spedisce. Il messaggio esce quando lo manda una persona.
// ============================================================

export const DEFAULT_BATCH = 5;
export const MAX_BATCH = 20;

/** Tetto giornaliero per tipo di job. Le generazioni costano di più. */
export const DAILY_LIMITS: Record<JobKind, number> = {
  analyze_website: 200,
  research_business: 60,
  generate_site: 25,
  run_site_qa: 50,
  prepare_outreach: 40,
  schedule_followup: 200,
};

export function isFactoryPaused(): boolean {
  const v = (process.env.FACTORY_PAUSED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/** Base URL per le preview. Senza questa il demo_url non è costruibile. */
export function publicBaseUrl(): string {
  const explicit = process.env.FACTORY_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export interface WorkerResult {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped_limit: JobKind[];
  paused: boolean;
  recovered_leases: number;
  details: { job_id: string; kind: JobKind; lead_id: string; outcome: string }[];
}

interface LeadContext {
  lead_id: string;
  name: string;
  category: string;
  city: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  maps_url: string;
  rating: number;
  reviews: number;
}

const metaStr = (meta: Record<string, unknown>, key: string): string => {
  const v = meta[key];
  return typeof v === "string" ? v : "";
};
const metaNum = (meta: Record<string, unknown>, key: string): number => {
  const v = meta[key];
  return typeof v === "number" ? v : Number(v) || 0;
};

/** Raccoglie ciò che si sa del lead dalle tabelle esistenti. La
 *  pipeline resta la fonte di verità: qui non si duplica niente. */
async function leadContext(leadId: string): Promise<LeadContext | null> {
  const lead = await getLeadById(leadId);
  if (!lead) return null;
  const meta = (lead.meta ?? {}) as Record<string, unknown>;
  const pipeline = await getPipelineLead(leadId).catch(() => null);
  const placeId = pipeline?.place_id ?? "";
  return {
    lead_id: leadId,
    name: lead.company || lead.name,
    category: pipeline?.category || metaStr(meta, "category"),
    city: pipeline?.city || metaStr(meta, "city"),
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    address: metaStr(meta, "address"),
    website: metaStr(meta, "website"),
    maps_url: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : "",
    rating: metaNum(meta, "rating"),
    reviews: metaNum(meta, "reviews"),
  };
}

/** Errore che non guarisce riprovando: non va ritentato. */
class FatalJobError extends Error {}

// ----- Handler per tipo di job -----------------------------------

async function handleAnalyzeWebsite(job: AgentJob): Promise<string> {
  const ctx = await leadContext(job.lead_id);
  if (!ctx) throw new FatalJobError("lead inesistente");

  const analysis = await analyzeWebsite(ctx.website);
  await saveWebsiteAnalysis(job.lead_id, analysis);
  await logActivity({
    lead_id: job.lead_id,
    type: "research",
    subject: `Analisi sito: ${analysis.status} (${analysis.opportunity_score}/100)`,
    body: analysis.reasons.map((r) => `· ${r.label}${r.measured ? ` (${r.measured})` : ""}`).join("\n"),
    metadata: { analysis },
    created_by: "ai",
  });

  if (!isEligible(analysis)) {
    await setFactoryStage(job.lead_id, "rejected");
    return `scartato: ${analysis.status}, punteggio ${analysis.opportunity_score}`;
  }

  await setFactoryStage(job.lead_id, "eligible");
  const project = await getOrCreateProject(job.lead_id, "generation_pending");
  await enqueueJob({
    lead_id: job.lead_id,
    kind: "generate_site",
    reason: `Opportunità ${analysis.opportunity_score}/100: ${analysis.status}`,
    payload: { analysis },
    forge_project_id: project?.id ?? "",
    priority: analysis.opportunity_score,
    budget: 1,
  });
  return `eleggibile: ${analysis.status}, punteggio ${analysis.opportunity_score}`;
}

async function handleResearchBusiness(job: AgentJob): Promise<string> {
  const ctx = await leadContext(job.lead_id);
  if (!ctx) throw new FatalJobError("lead inesistente");

  // I dati raccolti NON entrano direttamente nel sito: diventano fatti
  // PROPOSTI, che una persona approva. È la differenza fra un CRM che
  // suggerisce e un CRM che si inventa i dati dei clienti.
  const proposals: { field: string; value: string }[] = [];
  const at = new Date().toISOString();
  const candidates: [string, string][] = [
    ["phone", ctx.phone],
    ["address", ctx.address],
    ["email", ctx.email],
  ];
  for (const [field, value] of candidates) {
    if (!value) continue;
    await proposeFact({
      lead_id: job.lead_id,
      field,
      value,
      band: "verified",
      source_url: "google_places",
      method: "places_search",
      evidence: { origin: "lead.meta", collected_at: at },
      status: "applied",
    });
    proposals.push({ field, value });
  }

  await logActivity({
    lead_id: job.lead_id,
    type: "research",
    subject: `Dati raccolti: ${proposals.length} campi con fonte`,
    body: proposals.map((p) => `· ${p.field}`).join("\n") || "Nessun campo disponibile.",
    created_by: "ai",
  });
  await setFactoryStage(job.lead_id, "eligible");
  return `${proposals.length} fatti registrati`;
}

async function handleGenerateSite(job: AgentJob): Promise<string> {
  const ctx = await leadContext(job.lead_id);
  if (!ctx) throw new FatalJobError("lead inesistente");
  if (!ctx.name) throw new FatalJobError("lead senza nome: niente da generare");

  const project =
    (job.forge_project_id ? await getProject(job.forge_project_id) : null) ??
    (await getOrCreateProject(job.lead_id, "generating"));
  if (!project) throw new Error("progetto Forge non creabile (DB non configurato)");

  await setProjectStage(project.id, "generating");
  await setFactoryStage(job.lead_id, "generating");

  const input = factsFromPlaces({
    lead_id: job.lead_id,
    name: ctx.name,
    category: ctx.category || "attività locale",
    address: ctx.address,
    phone: ctx.phone,
    maps_url: ctx.maps_url,
    rating: ctx.rating,
    reviews: ctx.reviews,
    city: ctx.city,
  });

  const { result, used_ai } = await generateSiteSpec(input);
  await saveProjectSpec(project.id, result.spec, "qa_pending");
  await setProjectDemoUrl(project.id, `${publicBaseUrl()}/preview/${project.slug}`);

  await logActivity({
    lead_id: job.lead_id,
    forge_project_id: project.id,
    type: "demo_generated",
    subject: `Bozza sito generata${used_ai ? "" : " (copy di riserva, Gemini non disponibile)"}`,
    body:
      result.dropped.length > 0
        ? `Dati scartati per mancanza di fonte o affermazioni non verificabili:\n${result.dropped
            .map((d) => `· ${d.field}: ${d.reason}`)
            .join("\n")}`
        : "Nessun dato scartato.",
    metadata: { dropped: result.dropped, used_ai },
    created_by: "ai",
  });

  await enqueueJob({
    lead_id: job.lead_id,
    kind: "run_site_qa",
    reason: "Bozza generata, da controllare prima di mostrarla",
    forge_project_id: project.id,
    priority: job.priority,
  });
  return `spec generata, ${result.dropped.length} dati scartati`;
}

async function handleRunSiteQa(job: AgentJob): Promise<string> {
  const project = job.forge_project_id ? await getProject(job.forge_project_id) : null;
  if (!project) throw new FatalJobError("progetto Forge inesistente");

  // Screenshot solo se richiesto: su serverless costa tempo e può non
  // partire, e il QA non deve dipendere dal browser per dare un verdetto.
  const wantShots = job.payload.screenshots === true;
  const report = await runQa(project.spec, {
    previewUrl: project.demo_url,
    screenshots: wantShots,
  });

  const stage: FactoryStage = report.passed ? "ready" : "qa_failed";
  await saveProjectQa(project.id, report, stage);
  await setFactoryStage(job.lead_id, stage);
  await logActivity({
    lead_id: job.lead_id,
    forge_project_id: project.id,
    type: "qa",
    subject: qaSummary(report),
    body: report.checks
      .map((c) => `${c.passed ? "ok" : c.blocking ? "BLOCCA" : "minore"} · ${c.label}${c.detail ? ` — ${c.detail}` : ""}`)
      .join("\n"),
    metadata: { score: report.score, passed: report.passed },
    created_by: "ai",
  });

  if (!report.passed) {
    // Non si ritenta da soli: una spec bocciata si ricorregge, e
    // rigenerare in loop brucerebbe quota senza cambiare il risultato.
    return `QA non superato (${report.score}/100): serve una correzione`;
  }

  await enqueueJob({
    lead_id: job.lead_id,
    kind: "prepare_outreach",
    reason: `Demo pronta (QA ${report.score}/100)`,
    forge_project_id: project.id,
    priority: job.priority,
  });
  return `QA superato (${report.score}/100)`;
}

async function handlePrepareOutreach(job: AgentJob): Promise<string> {
  const ctx = await leadContext(job.lead_id);
  if (!ctx) throw new FatalJobError("lead inesistente");
  const project = job.forge_project_id ? await getProject(job.forge_project_id) : null;
  if (!project) throw new FatalJobError("progetto Forge inesistente");

  const analysis = await analyzeWebsite(ctx.website);
  const { draft, used_ai } = await prepareOutreach({
    business_name: ctx.name,
    category: ctx.category,
    city: ctx.city,
    analysis,
    demo_url: project.demo_url,
    spec: project.spec,
  });

  await setProjectStage(project.id, "outreach_ready");
  await setFactoryStage(job.lead_id, "outreach_ready");
  await logActivity({
    lead_id: job.lead_id,
    forge_project_id: project.id,
    type: "ai_action",
    subject: "Messaggio di primo contatto pronto (da inviare a mano)",
    body: draft.whatsapp,
    metadata: { draft, used_ai },
    created_by: "ai",
  });
  await scheduleFollowup({
    lead_id: job.lead_id,
    forge_project_id: project.id,
    title: "Ricontattare dopo invio bozza",
    note: draft.reason,
    due_at: draft.next_followup_at,
  });
  return "bozza di contatto pronta";
}

async function handleScheduleFollowup(job: AgentJob): Promise<string> {
  const title = typeof job.payload.title === "string" ? job.payload.title : "Ricontattare";
  const dueAt =
    typeof job.payload.due_at === "string"
      ? job.payload.due_at
      : new Date(Date.now() + 3 * 86_400_000).toISOString();
  const res = await scheduleFollowup({
    lead_id: job.lead_id,
    forge_project_id: job.forge_project_id,
    title,
    due_at: dueAt,
    note: job.reason,
  });
  return res.created ? `promemoria creato per ${dueAt.slice(0, 10)}` : "promemoria già presente";
}

const HANDLERS: Record<JobKind, (job: AgentJob) => Promise<string>> = {
  analyze_website: handleAnalyzeWebsite,
  research_business: handleResearchBusiness,
  generate_site: handleGenerateSite,
  run_site_qa: handleRunSiteQa,
  prepare_outreach: handlePrepareOutreach,
  schedule_followup: handleScheduleFollowup,
};

// ----- Worker -----------------------------------------------------

export interface RunWorkerOptions {
  batch?: number;
  kinds?: JobKind[];
  /** true = nessuna scrittura, nessuna chiamata esterna: solo il piano. */
  dryRun?: boolean;
  workerId?: string;
}

/** In dry-run si guarda la coda e si dice cosa si farebbe, senza farlo. */
async function planDryRun(opts: RunWorkerOptions): Promise<WorkerResult> {
  const { listJobs } = await import("./queue");
  const pending = await listJobs({ status: "pending", limit: opts.batch ?? DEFAULT_BATCH });
  return {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    skipped_limit: [],
    paused: isFactoryPaused(),
    recovered_leases: 0,
    details: pending
      .filter((j) => !opts.kinds?.length || opts.kinds.includes(j.kind))
      .map((j) => ({
        job_id: j.id,
        kind: j.kind,
        lead_id: j.lead_id,
        outcome: `dry-run: eseguirei ${j.kind} perché "${j.reason}"`,
      })),
  };
}

/** Esegue fino a `batch` job. Un job che fallisce non blocca gli altri. */
export async function runWorker(opts: RunWorkerOptions = {}): Promise<WorkerResult> {
  const batch = Math.min(Math.max(1, opts.batch ?? DEFAULT_BATCH), MAX_BATCH);
  const workerId = opts.workerId ?? `worker-${process.pid}-${Date.now()}`;

  if (opts.dryRun) return planDryRun({ ...opts, batch });

  const result: WorkerResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    skipped_limit: [],
    paused: false,
    recovered_leases: 0,
    details: [],
  };

  if (isFactoryPaused()) {
    result.paused = true;
    return result;
  }
  if (!turso) return result;

  await ensureFactorySchema();
  result.recovered_leases = await recoverExpiredLeases();

  // Tetti giornalieri calcolati una volta per giro: il limite vale per
  // il lotto, non per il singolo job.
  const allowed: JobKind[] = [];
  const kinds = opts.kinds?.length ? opts.kinds : (Object.keys(DAILY_LIMITS) as JobKind[]);
  for (const kind of kinds) {
    if ((await jobsRunToday(kind)) >= DAILY_LIMITS[kind]) result.skipped_limit.push(kind);
    else allowed.push(kind);
  }
  if (allowed.length === 0) return result;

  for (let i = 0; i < batch; i++) {
    const job = await claimJob(workerId, allowed);
    if (!job) break;
    result.claimed++;
    try {
      const outcome = await HANDLERS[job.kind](job);
      await completeJob(job.id, outcome);
      result.succeeded++;
      result.details.push({ job_id: job.id, kind: job.kind, lead_id: job.lead_id, outcome });
    } catch (err) {
      const message = (err as Error).message;
      const fatal = err instanceof FatalJobError;
      const failure = await failJob(job.id, message, { fatal });
      result.failed++;
      result.details.push({
        job_id: job.id,
        kind: job.kind,
        lead_id: job.lead_id,
        outcome: failure.retrying ? `errore, riprovo: ${message}` : `errore definitivo: ${message}`,
      });
    }
  }

  return result;
}

/** Mette un lead in lavorazione: primo passo sempre l'analisi del sito. */
export async function enrollLead(
  leadId: string,
  reason = "lead selezionato per la Factory",
): Promise<{ enqueued: boolean; job_id: string }> {
  await ensureFactorySchema();
  await setFactoryStage(leadId, "research_pending");
  const res = await enqueueJob({
    lead_id: leadId,
    kind: "analyze_website",
    reason,
    priority: 5,
  });
  return { enqueued: res.created, job_id: res.id };
}
