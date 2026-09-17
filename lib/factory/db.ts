import { randomBytes, randomUUID } from "crypto";
import { turso } from "@/lib/turso";
import { aggiungiColonne, type RapportoMigrazione } from "./migrazioni";
import type {
  Activity,
  ActivityType,
  AgentJob,
  ContactFact,
  DemoView,
  FactBand,
  FactoryStage,
  FactStatus,
  Followup,
  ForgeProject,
  JobKind,
  JobStatus,
  QaReport,
  SiteSpec,
  WebsiteAnalysis,
} from "@/types/factory";

// ============================================================
// Factory data access (Turso). Stesso patto di lib/autopilot/db.ts:
// nessun mock store. Senza Turso le letture tornano vuote e le
// scritture sono no-op silenziose — la dashboard mostra lo stato
// "DB non configurato" invece di fingere che la coda giri.
// ============================================================

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const nullable = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

function parseJSON<T>(raw: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(str(raw) || "null");
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** Slug preview non enumerabile: 22 caratteri url-safe da CSPRNG. */
export function newSlug(): string {
  return randomBytes(16).toString("base64url").slice(0, 22);
}

// ----- Schema (auto-migrazione idempotente) --------------------
// Specchio runtime di lib/factory/schema.sql, come ensureZoneSchema().

let schemaEnsured = false;

/** Rapporto dell'ultima migrazione delle colonne: serve a poterla
 *  verificare dall'esterno invece di doverla dedurre. */
let ultimoRapporto: RapportoMigrazione | null = null;

export function rapportoMigrazione(): RapportoMigrazione | null {
  return ultimoRapporto;
}

export async function ensureFactorySchema(): Promise<void> {
  if (!turso || schemaEnsured) return;
  await turso.executeMultiple(`
    create table if not exists forge_projects (
      id                  text primary key,
      lead_id             text not null,
      slug                text not null unique,
      stage               text not null default 'discovered',
      spec_version        integer not null default 1,
      spec                text default '',
      template            text not null default 'local-business',
      demo_url            text default '',
      qa_score            integer not null default 0,
      qa_report           text default '',
      screenshot_desktop  text default '',
      screenshot_mobile   text default '',
      approved_at         text,
      created_at          text default (datetime('now')),
      updated_at          text default (datetime('now'))
    );
    create table if not exists agent_jobs (
      id               text primary key,
      lead_id          text default '',
      deal_id          text default '',
      forge_project_id text default '',
      kind             text not null,
      reason           text default '',
      payload          text default '{}',
      priority         integer not null default 0,
      budget           integer not null default 1,
      attempts         integer not null default 0,
      max_attempts     integer not null default 3,
      status           text not null default 'pending',
      due_at           text default (datetime('now')),
      leased_until     text,
      worker_id        text default '',
      started_at       text,
      finished_at      text,
      outcome          text default '',
      error            text default '',
      -- null = nessuna chiave (job concluso o volutamente ripetibile).
      -- NON stringa vuota: l'indice unico qui sotto è TOTALE, perché
      -- "on conflict(col)" in SQLite non accetta un indice parziale come
      -- bersaglio. SQLite considera i null tutti distinti, quindi più
      -- job senza chiave convivono senza collidere.
      idempotency_key  text,
      created_at       text default (datetime('now')),
      updated_at       text default (datetime('now'))
    );
    create table if not exists activities (
      id               text primary key,
      lead_id          text not null,
      forge_project_id text default '',
      type             text not null default 'note',
      subject          text default '',
      body             text default '',
      metadata         text default '{}',
      occurred_at      text default (datetime('now')),
      due_at           text,
      completed_at     text,
      created_by       text default 'system',
      created_at       text default (datetime('now')),
      updated_at       text default (datetime('now'))
    );
    create table if not exists contact_facts (
      id          text primary key,
      lead_id     text not null,
      field       text not null,
      value       text default '',
      band        text not null default 'possible',
      status      text not null default 'proposed',
      evidence    text default '{}',
      source_url  text default '',
      method      text default '',
      observed_at text default (datetime('now')),
      decided_at  text,
      created_at  text default (datetime('now'))
    );
    create table if not exists followups (
      id               text primary key,
      lead_id          text not null,
      forge_project_id text default '',
      title            text default '',
      note             text default '',
      due_at           text not null,
      completed_at     text,
      assigned_to      text default 'puccio',
      -- Come idempotency_key: null = nessun dedup, indice unico totale.
      dedup_key        text,
      created_at       text default (datetime('now')),
      updated_at       text default (datetime('now'))
    );
    create table if not exists demo_views (
      id               text primary key,
      forge_project_id text not null,
      lead_id          text default '',
      device           text default 'desktop',
      cta_clicked      text default '',
      viewed_at        text default (datetime('now'))
    );
    create unique index if not exists idx_agent_jobs_idem
      on agent_jobs(idempotency_key);
    create index if not exists idx_agent_jobs_claim on agent_jobs(status, due_at, priority);
    create index if not exists idx_agent_jobs_lead on agent_jobs(lead_id, kind);
    create index if not exists idx_forge_lead on forge_projects(lead_id);
    create index if not exists idx_forge_stage on forge_projects(stage);
    create index if not exists idx_activities_lead on activities(lead_id, occurred_at);
    create index if not exists idx_contact_facts_lead on contact_facts(lead_id, field);
    create index if not exists idx_followups_due on followups(due_at, completed_at);
    create unique index if not exists idx_followups_dedup
      on followups(dedup_key);
    create index if not exists idx_demo_views_project on demo_views(forge_project_id, viewed_at);
  `);

  // Colonne sulla pipeline dell'Autopilot.
  //
  // `autopilot_pipeline` e di un altro modulo e puo legittimamente non
  // esistere: se l'Autopilot non e mai partito su questo database, non
  // c'e niente da migrare, e non e un errore. Ma «non c'e» va
  // VERIFICATO, non dedotto da un'eccezione: «no such table» lo dice
  // anche un nome sbagliato o un database puntato male, e trattare i
  // tre casi allo stesso modo produce uno schema aggiornato a meta che
  // si comporta bene finche qualcuno non legge una colonna assente.
  //
  // Vedi lib/factory/migrazioni.ts: esistenza chiesta a sqlite_master,
  // solo «duplicate column» tollerato, tutto il resto propagato.
  ultimoRapporto = await aggiungiColonne(turso, "autopilot_pipeline", [
    { nome: "website_status", definizione: "text default ''" },
    { nome: "website_opportunity_score", definizione: "integer not null default 0" },
    { nome: "website_reasons", definizione: "text default '[]'" },
    { nome: "website_checked_at", definizione: "text" },
    { nome: "factory_stage", definizione: "text default ''" },
  ]);

  schemaEnsured = true;
}

/** Solo per i test: forza la rivalutazione dello schema. */
export function resetFactorySchemaCache(): void {
  schemaEnsured = false;
}

// ----- Forge projects -------------------------------------------

function rowToProject(r: Row): ForgeProject {
  return {
    id: str(r.id),
    lead_id: str(r.lead_id),
    slug: str(r.slug),
    stage: str(r.stage) as FactoryStage,
    spec_version: num(r.spec_version),
    spec: parseJSON<SiteSpec | null>(r.spec, null),
    template: str(r.template),
    demo_url: str(r.demo_url),
    qa_score: num(r.qa_score),
    qa_report: parseJSON<QaReport | null>(r.qa_report, null),
    screenshot_desktop: str(r.screenshot_desktop),
    screenshot_mobile: str(r.screenshot_mobile),
    approved_at: nullable(r.approved_at),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

/** Un solo progetto per lead: se esiste lo restituisce, non ne crea un altro. */
export async function getOrCreateProject(
  leadId: string,
  stage: FactoryStage = "discovered",
): Promise<ForgeProject | null> {
  if (!turso) return null;
  await ensureFactorySchema();
  const existing = await getProjectByLead(leadId);
  if (existing) return existing;
  const id = randomUUID();
  await turso.execute({
    sql: `insert into forge_projects (id, lead_id, slug, stage) values (?, ?, ?, ?)`,
    args: [id, leadId, newSlug(), stage],
  });
  return getProject(id);
}

export async function getProject(id: string): Promise<ForgeProject | null> {
  if (!turso) return null;
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: "select * from forge_projects where id = ? limit 1",
    args: [id],
  });
  return rs.rows[0] ? rowToProject(rs.rows[0] as Row) : null;
}

export async function getProjectByLead(leadId: string): Promise<ForgeProject | null> {
  if (!turso) return null;
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: "select * from forge_projects where lead_id = ? order by created_at desc limit 1",
    args: [leadId],
  });
  return rs.rows[0] ? rowToProject(rs.rows[0] as Row) : null;
}

export async function getProjectBySlug(slug: string): Promise<ForgeProject | null> {
  if (!turso) return null;
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: "select * from forge_projects where slug = ? limit 1",
    args: [slug],
  });
  return rs.rows[0] ? rowToProject(rs.rows[0] as Row) : null;
}

export async function listProjects(limit = 200): Promise<ForgeProject[]> {
  if (!turso) return [];
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: "select * from forge_projects order by updated_at desc limit ?",
    args: [limit],
  });
  return rs.rows.map((r) => rowToProject(r as Row));
}

export async function saveProjectSpec(
  id: string,
  spec: SiteSpec,
  stage: FactoryStage,
): Promise<void> {
  if (!turso) return;
  await ensureFactorySchema();
  await turso.execute({
    sql: `update forge_projects
             set spec = ?, spec_version = ?, stage = ?, updated_at = datetime('now')
           where id = ?`,
    args: [JSON.stringify(spec), spec.spec_version, stage, id],
  });
}

export async function saveProjectQa(
  id: string,
  report: QaReport,
  stage: FactoryStage,
): Promise<void> {
  if (!turso) return;
  await ensureFactorySchema();
  await turso.execute({
    sql: `update forge_projects
             set qa_report = ?, qa_score = ?, stage = ?,
                 screenshot_desktop = ?, screenshot_mobile = ?,
                 updated_at = datetime('now')
           where id = ?`,
    args: [
      JSON.stringify(report),
      report.score,
      stage,
      report.screenshots.desktop,
      report.screenshots.mobile,
      id,
    ],
  });
}

export async function setProjectStage(id: string, stage: FactoryStage): Promise<void> {
  if (!turso) return;
  await ensureFactorySchema();
  await turso.execute({
    sql: "update forge_projects set stage = ?, updated_at = datetime('now') where id = ?",
    args: [stage, id],
  });
}

export async function setProjectDemoUrl(id: string, url: string): Promise<void> {
  if (!turso) return;
  await ensureFactorySchema();
  await turso.execute({
    sql: "update forge_projects set demo_url = ?, updated_at = datetime('now') where id = ?",
    args: [url, id],
  });
}

// ----- Analisi sito sulla pipeline ------------------------------

/** Scrive l'esito dell'analisi sul lead. La pipeline resta la fonte
 *  di verità del lead: la Factory non duplica lo stato commerciale. */
export async function saveWebsiteAnalysis(
  leadId: string,
  analysis: WebsiteAnalysis,
): Promise<void> {
  if (!turso) return;
  await ensureFactorySchema();
  await turso.execute({
    sql: `update autopilot_pipeline
             set website_status = ?, website_opportunity_score = ?,
                 website_reasons = ?, website_checked_at = ?,
                 updated_at = datetime('now')
           where lead_id = ?`,
    args: [
      analysis.status,
      analysis.opportunity_score,
      JSON.stringify(analysis.reasons),
      analysis.checked_at,
      leadId,
    ],
  });
}

export async function setFactoryStage(leadId: string, stage: FactoryStage): Promise<void> {
  if (!turso) return;
  await ensureFactorySchema();
  await turso.execute({
    sql: `update autopilot_pipeline
             set factory_stage = ?, updated_at = datetime('now')
           where lead_id = ?`,
    args: [stage, leadId],
  });
}

// ----- Activities (timeline) ------------------------------------

function rowToActivity(r: Row): Activity {
  return {
    id: str(r.id),
    lead_id: str(r.lead_id),
    forge_project_id: str(r.forge_project_id),
    type: str(r.type) as ActivityType,
    subject: str(r.subject),
    body: str(r.body),
    metadata: parseJSON<Record<string, unknown>>(r.metadata, {}),
    occurred_at: str(r.occurred_at),
    due_at: nullable(r.due_at),
    completed_at: nullable(r.completed_at),
    created_by: str(r.created_by),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

export async function logActivity(input: {
  lead_id: string;
  type: ActivityType;
  subject: string;
  body?: string;
  metadata?: Record<string, unknown>;
  forge_project_id?: string;
  created_by?: string;
  occurred_at?: string;
}): Promise<string> {
  if (!turso) return "";
  await ensureFactorySchema();
  const id = randomUUID();
  await turso.execute({
    sql: `insert into activities
            (id, lead_id, forge_project_id, type, subject, body, metadata, occurred_at, created_by)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.lead_id,
      input.forge_project_id ?? "",
      input.type,
      input.subject,
      input.body ?? "",
      JSON.stringify(input.metadata ?? {}),
      input.occurred_at ?? new Date().toISOString(),
      input.created_by ?? "system",
    ],
  });
  return id;
}

export async function listActivities(leadId: string, limit = 100): Promise<Activity[]> {
  if (!turso) return [];
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: `select * from activities where lead_id = ?
          order by occurred_at desc, created_at desc limit ?`,
    args: [leadId, limit],
  });
  return rs.rows.map((r) => rowToActivity(r as Row));
}

// ----- Contact facts (evidenza) ---------------------------------

function rowToContactFact(r: Row): ContactFact {
  return {
    id: str(r.id),
    lead_id: str(r.lead_id),
    field: str(r.field),
    value: str(r.value),
    band: str(r.band) as FactBand,
    status: str(r.status) as FactStatus,
    evidence: parseJSON<Record<string, unknown>>(r.evidence, {}),
    source_url: str(r.source_url),
    method: str(r.method),
    observed_at: str(r.observed_at),
    decided_at: nullable(r.decided_at),
    created_at: str(r.created_at),
  };
}

/** Un fatto proposto NON sostituisce quello applicato: convivono e
 *  la decisione resta all'operatore (approve/dismiss). */
export async function proposeFact(input: {
  lead_id: string;
  field: string;
  value: string;
  band: FactBand;
  source_url: string;
  method: string;
  evidence?: Record<string, unknown>;
  observed_at?: string;
  status?: FactStatus;
}): Promise<string> {
  if (!turso) return "";
  await ensureFactorySchema();
  const id = randomUUID();
  await turso.execute({
    sql: `insert into contact_facts
            (id, lead_id, field, value, band, status, evidence, source_url, method, observed_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.lead_id,
      input.field,
      input.value,
      input.band,
      input.status ?? "proposed",
      JSON.stringify(input.evidence ?? {}),
      input.source_url,
      input.method,
      input.observed_at ?? new Date().toISOString(),
    ],
  });
  return id;
}

export async function listFacts(leadId: string): Promise<ContactFact[]> {
  if (!turso) return [];
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: "select * from contact_facts where lead_id = ? order by created_at desc",
    args: [leadId],
  });
  return rs.rows.map((r) => rowToContactFact(r as Row));
}

/** Approvare un fatto declassa a `superseded` i fatti applicati sullo
 *  stesso campo: un solo valore corrente per campo, storia conservata. */
export async function decideFact(
  id: string,
  decision: "applied" | "dismissed",
): Promise<void> {
  if (!turso) return;
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: "select lead_id, field from contact_facts where id = ? limit 1",
    args: [id],
  });
  const row = rs.rows[0] as Row | undefined;
  if (!row) return;
  if (decision === "applied") {
    await turso.execute({
      sql: `update contact_facts set status = 'superseded', decided_at = datetime('now')
             where lead_id = ? and field = ? and status = 'applied' and id <> ?`,
      args: [str(row.lead_id), str(row.field), id],
    });
  }
  await turso.execute({
    sql: "update contact_facts set status = ?, decided_at = datetime('now') where id = ?",
    args: [decision, id],
  });
}

// ----- Followups ------------------------------------------------

function rowToFollowup(r: Row): Followup {
  return {
    id: str(r.id),
    lead_id: str(r.lead_id),
    forge_project_id: str(r.forge_project_id),
    title: str(r.title),
    note: str(r.note),
    due_at: str(r.due_at),
    completed_at: nullable(r.completed_at),
    assigned_to: str(r.assigned_to),
    dedup_key: str(r.dedup_key),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

/** Chiave anti-duplicato: stesso lead + stesso titolo + stesso giorno
 *  producono un solo promemoria, anche se il dispatcher rigira. */
export function followupDedupKey(leadId: string, title: string, dueAt: string): string {
  const normTitle = title.toLowerCase().replace(/\s+/g, " ").trim();
  return `${leadId}|${normTitle}|${dueAt.slice(0, 10)}`;
}

export async function scheduleFollowup(input: {
  lead_id: string;
  title: string;
  due_at: string;
  note?: string;
  forge_project_id?: string;
}): Promise<{ id: string; created: boolean }> {
  if (!turso) return { id: "", created: false };
  await ensureFactorySchema();
  const key = followupDedupKey(input.lead_id, input.title, input.due_at);
  const id = randomUUID();
  const rs = await turso.execute({
    sql: `insert into followups (id, lead_id, forge_project_id, title, note, due_at, dedup_key)
          values (?, ?, ?, ?, ?, ?, ?)
          on conflict(dedup_key) do nothing`,
    args: [
      id,
      input.lead_id,
      input.forge_project_id ?? "",
      input.title,
      input.note ?? "",
      input.due_at,
      key,
    ],
  });
  return { id, created: rs.rowsAffected > 0 };
}

export async function listFollowups(opts?: {
  leadId?: string;
  onlyOpen?: boolean;
  limit?: number;
}): Promise<Followup[]> {
  if (!turso) return [];
  await ensureFactorySchema();
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts?.leadId) {
    where.push("lead_id = ?");
    args.push(opts.leadId);
  }
  if (opts?.onlyOpen) where.push("completed_at is null");
  args.push(opts?.limit ?? 200);
  const rs = await turso.execute({
    sql: `select * from followups
          ${where.length ? `where ${where.join(" and ")}` : ""}
          order by due_at asc limit ?`,
    args: args as never[],
  });
  return rs.rows.map((r) => rowToFollowup(r as Row));
}

export async function completeFollowup(id: string): Promise<void> {
  if (!turso) return;
  await ensureFactorySchema();
  await turso.execute({
    sql: `update followups set completed_at = datetime('now'), updated_at = datetime('now')
           where id = ?`,
    args: [id],
  });
}

// ----- Demo views -----------------------------------------------

export async function recordDemoView(input: {
  forge_project_id: string;
  lead_id: string;
  device: string;
  cta_clicked?: string;
}): Promise<void> {
  if (!turso) return;
  await ensureFactorySchema();
  await turso.execute({
    sql: `insert into demo_views (id, forge_project_id, lead_id, device, cta_clicked)
          values (?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      input.forge_project_id,
      input.lead_id,
      input.device === "mobile" ? "mobile" : "desktop",
      input.cta_clicked ?? "",
    ],
  });
}

export async function listDemoViews(projectId: string, limit = 100): Promise<DemoView[]> {
  if (!turso) return [];
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: "select * from demo_views where forge_project_id = ? order by viewed_at desc limit ?",
    args: [projectId, limit],
  });
  return rs.rows.map((r) => {
    const row = r as Row;
    return {
      id: str(row.id),
      forge_project_id: str(row.forge_project_id),
      lead_id: str(row.lead_id),
      device: str(row.device),
      cta_clicked: str(row.cta_clicked),
      viewed_at: str(row.viewed_at),
    };
  });
}

// ----- Agent jobs (riga → oggetto; la coda vive in queue.ts) -----

export function rowToJob(r: Row): AgentJob {
  return {
    id: str(r.id),
    lead_id: str(r.lead_id),
    deal_id: str(r.deal_id),
    forge_project_id: str(r.forge_project_id),
    kind: str(r.kind) as JobKind,
    reason: str(r.reason),
    payload: parseJSON<Record<string, unknown>>(r.payload, {}),
    priority: num(r.priority),
    budget: num(r.budget),
    attempts: num(r.attempts),
    max_attempts: num(r.max_attempts),
    status: str(r.status) as JobStatus,
    due_at: str(r.due_at),
    leased_until: nullable(r.leased_until),
    worker_id: str(r.worker_id),
    started_at: nullable(r.started_at),
    finished_at: nullable(r.finished_at),
    outcome: str(r.outcome),
    error: str(r.error),
    idempotency_key: str(r.idempotency_key),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}
