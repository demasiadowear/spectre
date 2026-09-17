import { randomUUID } from "crypto";
import { turso } from "@/lib/turso";
import { ensureFactorySchema, rowToJob } from "./db";
import type { AgentJob, JobKind, JobStatus } from "@/types/factory";

// ============================================================
// Coda agentica persistente su Turso.
//
// libSQL NON ha `for update skip locked`, quindi il claim è un UPDATE
// CONDIZIONALE: si aggiorna la riga solo se è ANCORA `pending` nel
// momento della scrittura. Due worker che puntano allo stesso job
// producono una sola riga aggiornata; il secondo vede rowsAffected 0 e
// passa al successivo. È l'unica parte del modulo dove un errore non
// si vede subito ma si paga in doppioni, quindi ha test dedicati.
//
// Ogni job porta con sé:
//  - `reason`: perché esiste. Un'azione automatica senza motivo
//    leggibile non è verificabile, e questo sistema parla con clienti
//    reali per conto di una persona reale.
//  - `budget`: quante chiamate esterne può fare. Tetto di spesa, non
//    un suggerimento.
//  - `idempotency_key`: un solo job vivo per (lead, kind).
// ============================================================

/** Durata del lease: oltre questa un job `running` è considerato morto. */
export const LEASE_MS = 5 * 60 * 1000;
/** Backoff esponenziale fra i tentativi: 1', 5', 25'. */
export const BACKOFF_BASE_MS = 60 * 1000;
export const BACKOFF_FACTOR = 5;

const nowIso = () => new Date().toISOString();
const plus = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Chiave di idempotenza: un solo job vivo per lead e tipo. */
export function idempotencyKeyFor(leadId: string, kind: JobKind): string {
  return `${leadId}|${kind}`;
}

export function backoffMs(attempts: number): number {
  return BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, Math.max(0, attempts - 1));
}

export interface EnqueueInput {
  lead_id: string;
  kind: JobKind;
  /** Obbligatorio: perché questo job esiste. */
  reason: string;
  payload?: Record<string, unknown>;
  priority?: number;
  budget?: number;
  max_attempts?: number;
  due_at?: string;
  forge_project_id?: string;
  /** false = consente più job dello stesso tipo sul lead (rari casi). */
  idempotent?: boolean;
}

export interface EnqueueResult {
  id: string;
  /** false = esisteva già un job vivo per (lead, kind): nessun doppione. */
  created: boolean;
}

/** Accoda un job. Con `idempotent` (default) un job già vivo vince. */
export async function enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
  if (!turso) return { id: "", created: false };
  await ensureFactorySchema();
  const id = randomUUID();
  // null (non "") quando il job è volutamente ripetibile: l'indice
  // unico su idempotency_key è totale e SQLite non fa collidere i null.
  const idem =
    input.idempotent === false ? null : idempotencyKeyFor(input.lead_id, input.kind);

  // Il job "vivo" è quello non ancora concluso. Un job chiuso non deve
  // bloccare per sempre il rifacimento: alla chiusura la chiave viene
  // liberata (vedi releaseKey).
  const rs = await turso.execute({
    sql: `insert into agent_jobs
            (id, lead_id, forge_project_id, kind, reason, payload, priority,
             budget, max_attempts, status, due_at, idempotency_key)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          on conflict(idempotency_key) do nothing`,
    args: [
      id,
      input.lead_id,
      input.forge_project_id ?? "",
      input.kind,
      input.reason,
      JSON.stringify(input.payload ?? {}),
      input.priority ?? 0,
      input.budget ?? 1,
      input.max_attempts ?? 3,
      input.due_at ?? nowIso(),
      idem,
    ],
  });
  return { id, created: rs.rowsAffected > 0 };
}

/** Libera la chiave di idempotenza: il job resta, la storia si conserva,
 *  ma un nuovo job dello stesso tipo torna possibile. */
async function releaseKey(id: string): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: "update agent_jobs set idempotency_key = null where id = ?",
    args: [id],
  });
}

/** Rimette in `pending` i job il cui lease è scaduto (worker morto). */
export async function recoverExpiredLeases(): Promise<number> {
  if (!turso) return 0;
  await ensureFactorySchema();
  const now = nowIso();
  // Chi ha esaurito i tentativi non torna pending: va a `failed`,
  // altrimenti un worker che muore sempre sullo stesso job cicla.
  await turso.execute({
    sql: `update agent_jobs
             set status = 'failed', error = 'lease scaduto, tentativi esauriti',
                 finished_at = ?, leased_until = null, idempotency_key = null,
                 updated_at = ?
           where status = 'running' and leased_until is not null
             and leased_until < ? and attempts >= max_attempts`,
    args: [now, now, now],
  });
  const rs = await turso.execute({
    sql: `update agent_jobs
             set status = 'pending', leased_until = null, worker_id = '',
                 error = 'lease scaduto, riprovo', updated_at = ?
           where status = 'running' and leased_until is not null
             and leased_until < ? and attempts < max_attempts`,
    args: [now, now],
  });
  return rs.rowsAffected;
}

/**
 * Acquisisce UN job. `null` = niente da fare.
 *
 * Il subquery scegle il candidato, ma è `and status = 'pending'`
 * nell'UPDATE a garantire l'esclusività: se un altro worker lo ha già
 * preso fra la select e la write, rowsAffected è 0 e si ritenta con il
 * candidato successivo.
 */
export async function claimJob(workerId: string, kinds?: JobKind[]): Promise<AgentJob | null> {
  if (!turso) return null;
  await ensureFactorySchema();

  const kindFilter = kinds?.length
    ? ` and kind in (${kinds.map(() => "?").join(",")})`
    : "";

  // Qualche tentativo: perdere la corsa non significa coda vuota.
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = nowIso();
    const lease = plus(LEASE_MS);
    const rs = await turso.execute({
      sql: `update agent_jobs
               set status = 'running', worker_id = ?, leased_until = ?,
                   started_at = ?, attempts = attempts + 1, updated_at = ?
             where id = (select id from agent_jobs
                          where status = 'pending' and due_at <= ?${kindFilter}
                          order by priority desc, due_at asc
                          limit 1)
               and status = 'pending'
             returning id`,
      args: [workerId, lease, now, now, now, ...(kinds ?? [])] as never[],
    });
    if (rs.rows.length > 0) {
      const claimed = await turso.execute({
        sql: "select * from agent_jobs where id = ? limit 1",
        args: [String((rs.rows[0] as Record<string, unknown>).id)],
      });
      return claimed.rows[0] ? rowToJob(claimed.rows[0] as Record<string, unknown>) : null;
    }
    // rowsAffected 0 con candidati presenti = corsa persa: si riprova.
    const pending = await turso.execute({
      sql: `select count(*) as n from agent_jobs
             where status = 'pending' and due_at <= ?${kindFilter}`,
      args: [now, ...(kinds ?? [])] as never[],
    });
    const n = Number((pending.rows[0] as Record<string, unknown>)?.n ?? 0);
    if (n === 0) return null;
  }
  return null;
}

/** Prolunga il lease di un job lungo (QA con browser, ricerche). */
export async function extendLease(id: string, workerId: string): Promise<boolean> {
  if (!turso) return false;
  const rs = await turso.execute({
    sql: `update agent_jobs set leased_until = ?, updated_at = ?
           where id = ? and worker_id = ? and status = 'running'`,
    args: [plus(LEASE_MS), nowIso(), id, workerId],
  });
  return rs.rowsAffected > 0;
}

export async function completeJob(id: string, outcome: string): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `update agent_jobs
             set status = 'succeeded', outcome = ?, error = '',
                 finished_at = ?, leased_until = null, updated_at = ?
           where id = ?`,
    args: [outcome.slice(0, 2000), nowIso(), nowIso(), id],
  });
  await releaseKey(id);
}

/** Il job aspetta una decisione umana. Non riprova e non scade. */
export async function parkJob(id: string, reason: string): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `update agent_jobs
             set status = 'waiting_approval', outcome = ?, leased_until = null,
                 updated_at = ?
           where id = ?`,
    args: [reason.slice(0, 2000), nowIso(), id],
  });
}

export interface FailResult {
  /** true = rimesso in coda con backoff; false = esaurito. */
  retrying: boolean;
  retry_at: string;
}

/** Fallimento: ritenta con backoff finché ci sono tentativi. */
export async function failJob(
  id: string,
  error: string,
  opts?: { fatal?: boolean },
): Promise<FailResult> {
  if (!turso) return { retrying: false, retry_at: "" };
  const rs = await turso.execute({
    sql: "select attempts, max_attempts from agent_jobs where id = ? limit 1",
    args: [id],
  });
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  const attempts = Number(row?.attempts ?? 0);
  const maxAttempts = Number(row?.max_attempts ?? 3);
  // `fatal` = errore che non guarisce riprovando (input non valido,
  // lead senza dati): ritentare sarebbe solo spesa.
  const retrying = !opts?.fatal && attempts < maxAttempts;
  const retryAt = plus(backoffMs(attempts));

  if (retrying) {
    await turso.execute({
      sql: `update agent_jobs
               set status = 'pending', error = ?, due_at = ?, leased_until = null,
                   worker_id = '', updated_at = ?
             where id = ?`,
      args: [error.slice(0, 2000), retryAt, nowIso(), id],
    });
    return { retrying: true, retry_at: retryAt };
  }

  await turso.execute({
    sql: `update agent_jobs
             set status = 'failed', error = ?, finished_at = ?, leased_until = null,
                 updated_at = ?
           where id = ?`,
    args: [error.slice(0, 2000), nowIso(), nowIso(), id],
  });
  await releaseKey(id);
  return { retrying: false, retry_at: "" };
}

/** Annulla un job non ancora concluso. Idempotente. */
export async function cancelJob(id: string, reason = "annullato a mano"): Promise<boolean> {
  if (!turso) return false;
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: `update agent_jobs
             set status = 'cancelled', error = ?, finished_at = ?,
                 leased_until = null, idempotency_key = null, updated_at = ?
           where id = ? and status in ('pending', 'running', 'waiting_approval')`,
    args: [reason, nowIso(), nowIso(), id],
  });
  return rs.rowsAffected > 0;
}

/** Annulla tutta la coda viva di un lead (freno d'emergenza). */
export async function cancelLeadJobs(leadId: string, reason = "lead fermato"): Promise<number> {
  if (!turso) return 0;
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: `update agent_jobs
             set status = 'cancelled', error = ?, finished_at = ?,
                 leased_until = null, idempotency_key = null, updated_at = ?
           where lead_id = ? and status in ('pending', 'running', 'waiting_approval')`,
    args: [reason, nowIso(), nowIso(), leadId],
  });
  return rs.rowsAffected;
}

export async function getJob(id: string): Promise<AgentJob | null> {
  if (!turso) return null;
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: "select * from agent_jobs where id = ? limit 1",
    args: [id],
  });
  return rs.rows[0] ? rowToJob(rs.rows[0] as Record<string, unknown>) : null;
}

export async function listJobs(opts?: {
  status?: JobStatus;
  leadId?: string;
  limit?: number;
}): Promise<AgentJob[]> {
  if (!turso) return [];
  await ensureFactorySchema();
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts?.status) {
    where.push("status = ?");
    args.push(opts.status);
  }
  if (opts?.leadId) {
    where.push("lead_id = ?");
    args.push(opts.leadId);
  }
  args.push(opts?.limit ?? 100);
  const rs = await turso.execute({
    sql: `select * from agent_jobs
          ${where.length ? `where ${where.join(" and ")}` : ""}
          order by
            case status when 'running' then 0 when 'pending' then 1
                        when 'waiting_approval' then 2 else 3 end,
            priority desc, due_at asc
          limit ?`,
    args: args as never[],
  });
  return rs.rows.map((r) => rowToJob(r as Record<string, unknown>));
}

/** Conteggi per la dashboard operativa. */
export async function queueCounts(): Promise<Record<JobStatus, number>> {
  const empty: Record<JobStatus, number> = {
    pending: 0,
    running: 0,
    waiting_approval: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  if (!turso) return empty;
  await ensureFactorySchema();
  const rs = await turso.execute("select status, count(*) as n from agent_jobs group by status");
  for (const r of rs.rows) {
    const row = r as Record<string, unknown>;
    const status = String(row.status) as JobStatus;
    if (status in empty) empty[status] = Number(row.n ?? 0);
  }
  return empty;
}

/** Job conclusi nelle ultime 24h per tipo: base del limite giornaliero. */
export async function jobsRunToday(kind: JobKind): Promise<number> {
  if (!turso) return 0;
  await ensureFactorySchema();
  const rs = await turso.execute({
    sql: `select count(*) as n from agent_jobs
           where kind = ? and started_at is not null
             and started_at >= datetime('now', '-1 day')`,
    args: [kind],
  });
  return Number((rs.rows[0] as Record<string, unknown>)?.n ?? 0);
}
