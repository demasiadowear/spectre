import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

// ============================================================
// Coda agentica, provata contro un libSQL VERO in memoria.
//
// Il claim atomico è l'unica parte del modulo che può sbagliare in
// silenzio: un difetto qui non si vede come errore, si vede come due
// worker che generano due volte lo stesso sito e spendono due volte.
// Perciò qui non si finge il database: si esegue l'SQL vero, con lo
// stesso dialetto che gira in produzione.
//
// L'env va impostato PRIMA di importare lib/turso, che crea il client
// al momento del load: da qui l'import dinamico.
// ============================================================

process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "test";

type QueueModule = typeof import("@/lib/factory/queue");
type DbModule = typeof import("@/lib/factory/db");

let queue: QueueModule;
let db: DbModule;
let turso: import("@libsql/client").Client;

before(async () => {
  queue = await import("@/lib/factory/queue");
  db = await import("@/lib/factory/db");
  const mod = await import("@/lib/turso");
  assert.ok(mod.turso, "client libSQL in memoria non creato");
  turso = mod.turso;
});

beforeEach(async () => {
  await turso.executeMultiple("drop table if exists agent_jobs;");
  db.resetFactorySchemaCache();
  await db.ensureFactorySchema();
});

const enqueue = (over: Partial<Parameters<QueueModule["enqueueJob"]>[0]> = {}) =>
  queue.enqueueJob({
    lead_id: "lead-1",
    kind: "analyze_website",
    reason: "lead senza sito su Google",
    ...over,
  });

describe("enqueueJob", () => {
  it("accoda un job con la sua motivazione", async () => {
    const { id, created } = await enqueue();
    assert.equal(created, true);
    const job = await queue.getJob(id);
    assert.equal(job?.status, "pending");
    assert.equal(job?.reason, "lead senza sito su Google");
    assert.equal(job?.attempts, 0);
  });

  it("non crea doppioni per lo stesso lead e tipo", async () => {
    const first = await enqueue();
    const second = await enqueue();
    assert.equal(first.created, true);
    assert.equal(second.created, false, "doppione accodato");
    const all = await queue.listJobs({ leadId: "lead-1" });
    assert.equal(all.length, 1);
  });

  it("tipi diversi sullo stesso lead convivono", async () => {
    await enqueue();
    const other = await enqueue({ kind: "generate_site" });
    assert.equal(other.created, true);
    assert.equal((await queue.listJobs({ leadId: "lead-1" })).length, 2);
  });

  it("idempotent:false consente più job dello stesso tipo", async () => {
    await enqueue({ idempotent: false });
    const second = await enqueue({ idempotent: false });
    assert.equal(second.created, true);
  });
});

describe("claimJob", () => {
  it("prende il job e imposta lease, worker e tentativo", async () => {
    const { id } = await enqueue();
    const job = await queue.claimJob("worker-a");
    assert.equal(job?.id, id);
    assert.equal(job?.status, "running");
    assert.equal(job?.worker_id, "worker-a");
    assert.equal(job?.attempts, 1);
    assert.ok(job?.leased_until, "lease non impostato");
  });

  it("due worker non prendono mai lo stesso job", async () => {
    await enqueue();
    const [a, b] = await Promise.all([
      queue.claimJob("worker-a"),
      queue.claimJob("worker-b"),
    ]);
    const claimed = [a, b].filter(Boolean);
    assert.equal(claimed.length, 1, "lo stesso job è stato preso due volte");
  });

  it("dieci worker su tre job assegnano ogni job una volta sola", async () => {
    for (const lead of ["l1", "l2", "l3"]) await enqueue({ lead_id: lead });
    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, i) => queue.claimJob(`worker-${i}`)),
    );
    const ids = claims.filter(Boolean).map((j) => j!.id);
    assert.equal(ids.length, 3, `attesi 3 claim, ottenuti ${ids.length}`);
    assert.equal(new Set(ids).size, 3, "un job è stato assegnato due volte");
  });

  it("rispetta la priorità", async () => {
    await enqueue({ lead_id: "basso", priority: 0 });
    await enqueue({ lead_id: "alto", priority: 10 });
    const job = await queue.claimJob("worker-a");
    assert.equal(job?.lead_id, "alto");
  });

  it("non prende job non ancora scaduti", async () => {
    await enqueue({ due_at: new Date(Date.now() + 60_000).toISOString() });
    assert.equal(await queue.claimJob("worker-a"), null);
  });

  it("filtra per tipo", async () => {
    await enqueue({ kind: "generate_site" });
    assert.equal(await queue.claimJob("worker-a", ["run_site_qa"]), null);
    const job = await queue.claimJob("worker-a", ["generate_site"]);
    assert.equal(job?.kind, "generate_site");
  });

  it("su coda vuota torna null", async () => {
    assert.equal(await queue.claimJob("worker-a"), null);
  });
});

describe("failJob", () => {
  it("rimette in coda con backoff crescente", async () => {
    const { id } = await enqueue({ max_attempts: 3 });
    await queue.claimJob("worker-a");
    const first = await queue.failJob(id, "timeout");
    assert.equal(first.retrying, true);

    const job = await queue.getJob(id);
    assert.equal(job?.status, "pending");
    assert.equal(job?.error, "timeout");
    assert.ok(new Date(job!.due_at).getTime() > Date.now(), "retry non posticipato");
  });

  it("il backoff cresce di tentativo in tentativo", () => {
    assert.ok(queue.backoffMs(2) > queue.backoffMs(1));
    assert.ok(queue.backoffMs(3) > queue.backoffMs(2));
  });

  it("esaurisce i tentativi e va in failed", async () => {
    const { id } = await enqueue({ max_attempts: 2 });
    await queue.claimJob("worker-a");
    await queue.failJob(id, "errore 1");
    await turso.execute({
      sql: "update agent_jobs set due_at = datetime('now', '-1 hour') where id = ?",
      args: [id],
    });
    await queue.claimJob("worker-a");
    const second = await queue.failJob(id, "errore 2");
    assert.equal(second.retrying, false);
    assert.equal((await queue.getJob(id))?.status, "failed");
  });

  it("un errore fatale non viene mai ritentato", async () => {
    const { id } = await enqueue({ max_attempts: 5 });
    await queue.claimJob("worker-a");
    const res = await queue.failJob(id, "lead senza nome", { fatal: true });
    assert.equal(res.retrying, false);
    assert.equal((await queue.getJob(id))?.status, "failed");
  });

  it("un job fallito libera la chiave: si può riaccodare", async () => {
    const { id } = await enqueue();
    await queue.claimJob("worker-a");
    await queue.failJob(id, "ko", { fatal: true });
    assert.equal((await enqueue()).created, true);
  });
});

describe("completeJob", () => {
  it("chiude il job e libera la chiave di idempotenza", async () => {
    const { id } = await enqueue();
    await queue.claimJob("worker-a");
    await queue.completeJob(id, "sito analizzato");
    const job = await queue.getJob(id);
    assert.equal(job?.status, "succeeded");
    assert.equal(job?.outcome, "sito analizzato");
    assert.equal(job?.error, "");
    assert.equal((await enqueue()).created, true, "chiave non liberata");
  });
});

describe("parkJob", () => {
  it("mette il job in attesa di decisione umana", async () => {
    const { id } = await enqueue();
    await queue.claimJob("worker-a");
    await queue.parkJob(id, "serve approvazione sul telefono trovato");
    const job = await queue.getJob(id);
    assert.equal(job?.status, "waiting_approval");
    // Non deve tornare in circolo da solo.
    assert.equal(await queue.claimJob("worker-b"), null);
  });
});

describe("recoverExpiredLeases", () => {
  it("recupera un job il cui worker è morto", async () => {
    const { id } = await enqueue({ max_attempts: 3 });
    await queue.claimJob("worker-morto");
    await turso.execute({
      sql: "update agent_jobs set leased_until = ? where id = ?",
      args: [new Date(Date.now() - 1000).toISOString(), id],
    });
    assert.equal(await queue.recoverExpiredLeases(), 1);
    assert.equal((await queue.getJob(id))?.status, "pending");
    assert.ok(await queue.claimJob("worker-vivo"));
  });

  it("non cicla all'infinito: esauriti i tentativi va in failed", async () => {
    const { id } = await enqueue({ max_attempts: 1 });
    await queue.claimJob("worker-morto");
    await turso.execute({
      sql: "update agent_jobs set leased_until = ? where id = ?",
      args: [new Date(Date.now() - 1000).toISOString(), id],
    });
    await queue.recoverExpiredLeases();
    assert.equal((await queue.getJob(id))?.status, "failed");
  });

  it("non tocca i lease ancora validi", async () => {
    await enqueue();
    await queue.claimJob("worker-a");
    assert.equal(await queue.recoverExpiredLeases(), 0);
  });
});

describe("extendLease", () => {
  it("solo il worker proprietario può prolungare", async () => {
    const { id } = await enqueue();
    await queue.claimJob("worker-a");
    assert.equal(await queue.extendLease(id, "worker-a"), true);
    assert.equal(await queue.extendLease(id, "worker-b"), false);
  });
});

describe("cancel", () => {
  it("annulla un job in attesa", async () => {
    const { id } = await enqueue();
    assert.equal(await queue.cancelJob(id), true);
    assert.equal((await queue.getJob(id))?.status, "cancelled");
  });

  it("annullare due volte non fa danni", async () => {
    const { id } = await enqueue();
    await queue.cancelJob(id);
    assert.equal(await queue.cancelJob(id), false);
  });

  it("non annulla un job già concluso", async () => {
    const { id } = await enqueue();
    await queue.claimJob("worker-a");
    await queue.completeJob(id, "fatto");
    assert.equal(await queue.cancelJob(id), false);
    assert.equal((await queue.getJob(id))?.status, "succeeded");
  });

  it("il freno d'emergenza ferma tutta la coda di un lead", async () => {
    await enqueue({ kind: "analyze_website" });
    await enqueue({ kind: "generate_site" });
    await enqueue({ lead_id: "altro-lead", kind: "generate_site" });
    assert.equal(await queue.cancelLeadJobs("lead-1"), 2);

    const fermati = await queue.listJobs({ leadId: "lead-1" });
    assert.equal(fermati.length, 2);
    for (const j of fermati) {
      assert.equal(j.status, "cancelled", `job ${j.kind} sopravvissuto al freno`);
    }

    // Il freno è per lead: la coda degli altri continua a girare.
    const claimed = await queue.claimJob("worker-a");
    assert.equal(claimed?.lead_id, "altro-lead", "fermato anche un lead estraneo");
  });
});

describe("queueCounts", () => {
  it("conta per stato", async () => {
    await enqueue({ kind: "analyze_website" });
    const { id } = await enqueue({ kind: "generate_site" });
    await queue.claimJob("worker-a", ["generate_site"]);
    await queue.completeJob(id, "ok");
    const counts = await queue.queueCounts();
    assert.equal(counts.pending, 1);
    assert.equal(counts.succeeded, 1);
    assert.equal(counts.failed, 0);
  });
});

describe("jobsRunToday", () => {
  it("conta solo i job avviati nelle ultime 24 ore", async () => {
    await enqueue({ kind: "generate_site" });
    assert.equal(await queue.jobsRunToday("generate_site"), 0, "un job mai avviato non conta");
    await queue.claimJob("worker-a");
    assert.equal(await queue.jobsRunToday("generate_site"), 1);
    assert.equal(await queue.jobsRunToday("run_site_qa"), 0);
  });
});
