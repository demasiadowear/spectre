import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

// ============================================================
// CRM agentico: timeline, fatti con evidenza, promemoria, tracking
// demo. Come per la coda, si prova contro un libSQL vero in memoria:
// i vincoli che contano (unicità del dedup, un solo fatto applicato
// per campo) li fa rispettare il database, non il TypeScript.
// ============================================================

process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "test";

type DbModule = typeof import("@/lib/factory/db");

let db: DbModule;
let turso: import("@libsql/client").Client;

before(async () => {
  db = await import("@/lib/factory/db");
  const mod = await import("@/lib/turso");
  assert.ok(mod.turso, "client libSQL in memoria non creato");
  turso = mod.turso;
});

beforeEach(async () => {
  await turso.executeMultiple(`
    drop table if exists activities;
    drop table if exists contact_facts;
    drop table if exists followups;
    drop table if exists demo_views;
    drop table if exists forge_projects;
  `);
  db.resetFactorySchemaCache();
  await db.ensureFactorySchema();
});

describe("ensureFactorySchema", () => {
  it("è idempotente: rieseguirla non rompe niente", async () => {
    db.resetFactorySchemaCache();
    await db.ensureFactorySchema();
    db.resetFactorySchemaCache();
    await db.ensureFactorySchema();
    const rs = await turso.execute(
      "select name from sqlite_master where type='table' order by name",
    );
    const tables = rs.rows.map((r) => String((r as Record<string, unknown>).name));
    for (const t of [
      "activities",
      "agent_jobs",
      "contact_facts",
      "demo_views",
      "followups",
      "forge_projects",
    ]) {
      assert.ok(tables.includes(t), `tabella ${t} mancante`);
    }
  });
});

describe("newSlug", () => {
  it("produce slug di 22 caratteri url-safe", () => {
    const slug = db.newSlug();
    assert.equal(slug.length, 22);
    assert.match(slug, /^[A-Za-z0-9_-]{22}$/);
  });

  it("non si ripete: è la credenziale della preview", () => {
    const slugs = new Set(Array.from({ length: 500 }, () => db.newSlug()));
    assert.equal(slugs.size, 500, "collisione fra slug");
  });
});

describe("forge_projects", () => {
  it("un lead ha un solo progetto", async () => {
    const first = await db.getOrCreateProject("lead-1");
    const second = await db.getOrCreateProject("lead-1");
    assert.ok(first);
    assert.equal(second?.id, first.id, "creato un secondo progetto per lo stesso lead");
  });

  it("il progetto è raggiungibile dal suo slug", async () => {
    const project = await db.getOrCreateProject("lead-1");
    const found = await db.getProjectBySlug(project!.slug);
    assert.equal(found?.id, project!.id);
  });

  it("uno slug inesistente non restituisce nulla", async () => {
    assert.equal(await db.getProjectBySlug("AAAAAAAAAAAAAAAAAAAAAA"), null);
  });
});

describe("activities", () => {
  it("registra e rilegge la timeline", async () => {
    await db.logActivity({ lead_id: "lead-1", type: "call", subject: "Prima chiamata" });
    await db.logActivity({
      lead_id: "lead-1",
      type: "ai_action",
      subject: "Bozza pronta",
      metadata: { score: 92 },
      created_by: "ai",
    });
    const items = await db.listActivities("lead-1");
    assert.equal(items.length, 2);
    const ai = items.find((a) => a.type === "ai_action");
    assert.equal(ai?.created_by, "ai");
    assert.equal(ai?.metadata.score, 92);
  });

  it("distingue chi ha scritto la riga", async () => {
    await db.logActivity({ lead_id: "l", type: "note", subject: "a mano", created_by: "puccio" });
    await db.logActivity({ lead_id: "l", type: "research", subject: "automatica", created_by: "ai" });
    const authors = (await db.listActivities("l")).map((a) => a.created_by).sort();
    assert.deepEqual(authors, ["ai", "puccio"]);
  });

  it("le timeline di lead diversi non si mescolano", async () => {
    await db.logActivity({ lead_id: "lead-1", type: "note", subject: "uno" });
    await db.logActivity({ lead_id: "lead-2", type: "note", subject: "due" });
    assert.equal((await db.listActivities("lead-1")).length, 1);
  });

  it("metadata corrotta non fa esplodere la lettura", async () => {
    const id = await db.logActivity({ lead_id: "lead-1", type: "note", subject: "x" });
    await turso.execute({
      sql: "update activities set metadata = ? where id = ?",
      args: ["{non-json", id],
    });
    const items = await db.listActivities("lead-1");
    assert.deepEqual(items[0].metadata, {});
  });
});

describe("contact_facts", () => {
  it("un fatto nasce proposto, non applicato", async () => {
    await db.proposeFact({
      lead_id: "lead-1",
      field: "phone",
      value: "080 1234567",
      band: "probable",
      source_url: "https://esempio.it/contatti",
      method: "site_html",
    });
    const facts = await db.listFacts("lead-1");
    assert.equal(facts[0].status, "proposed");
    assert.equal(facts[0].band, "probable");
    assert.equal(facts[0].source_url, "https://esempio.it/contatti");
  });

  it("conserva l'evidenza", async () => {
    await db.proposeFact({
      lead_id: "lead-1",
      field: "email",
      value: "info@esempio.it",
      band: "possible",
      source_url: "https://esempio.it",
      method: "site_html",
      evidence: { snippet: "scrivici a info@esempio.it" },
    });
    const facts = await db.listFacts("lead-1");
    assert.equal(facts[0].evidence.snippet, "scrivici a info@esempio.it");
  });

  it("approvare registra la decisione", async () => {
    const id = await db.proposeFact({
      lead_id: "lead-1",
      field: "phone",
      value: "080 111",
      band: "probable",
      source_url: "s",
      method: "m",
    });
    await db.decideFact(id, "applied");
    const fact = (await db.listFacts("lead-1"))[0];
    assert.equal(fact.status, "applied");
    assert.ok(fact.decided_at, "decided_at non valorizzato");
  });

  it("un nuovo fatto approvato declassa il precedente sullo stesso campo", async () => {
    const vecchio = await db.proposeFact({
      lead_id: "lead-1",
      field: "phone",
      value: "080 111",
      band: "verified",
      source_url: "s1",
      method: "m",
      status: "applied",
    });
    const nuovo = await db.proposeFact({
      lead_id: "lead-1",
      field: "phone",
      value: "080 222",
      band: "verified",
      source_url: "s2",
      method: "m",
    });
    await db.decideFact(nuovo, "applied");

    const byId = new Map((await db.listFacts("lead-1")).map((f) => [f.id, f]));
    assert.equal(byId.get(nuovo)?.status, "applied");
    assert.equal(byId.get(vecchio)?.status, "superseded", "due valori applicati sullo stesso campo");
  });

  it("scartare non tocca i fatti di altri campi", async () => {
    const phone = await db.proposeFact({
      lead_id: "lead-1",
      field: "phone",
      value: "080 111",
      band: "verified",
      source_url: "s",
      method: "m",
      status: "applied",
    });
    const email = await db.proposeFact({
      lead_id: "lead-1",
      field: "email",
      value: "a@b.it",
      band: "possible",
      source_url: "s",
      method: "m",
    });
    await db.decideFact(email, "dismissed");
    const byId = new Map((await db.listFacts("lead-1")).map((f) => [f.id, f]));
    assert.equal(byId.get(phone)?.status, "applied");
    assert.equal(byId.get(email)?.status, "dismissed");
  });

  it("decidere un fatto inesistente non lancia", async () => {
    await db.decideFact("non-esiste", "applied");
  });
});

describe("followups", () => {
  const due = "2026-10-01T09:00:00.000Z";

  it("crea un promemoria", async () => {
    const res = await db.scheduleFollowup({
      lead_id: "lead-1",
      title: "Richiamare",
      due_at: due,
    });
    assert.equal(res.created, true);
    const items = await db.listFollowups({ leadId: "lead-1" });
    assert.equal(items.length, 1);
    assert.equal(items[0].completed_at, null);
  });

  it("non duplica lo stesso promemoria nello stesso giorno", async () => {
    await db.scheduleFollowup({ lead_id: "lead-1", title: "Richiamare", due_at: due });
    const second = await db.scheduleFollowup({
      lead_id: "lead-1",
      title: "  richiamare  ",
      due_at: "2026-10-01T18:00:00.000Z",
    });
    assert.equal(second.created, false, "promemoria duplicato nello stesso giorno");
    assert.equal((await db.listFollowups({ leadId: "lead-1" })).length, 1);
  });

  it("lo stesso titolo in un altro giorno è un promemoria nuovo", async () => {
    await db.scheduleFollowup({ lead_id: "lead-1", title: "Richiamare", due_at: due });
    const other = await db.scheduleFollowup({
      lead_id: "lead-1",
      title: "Richiamare",
      due_at: "2026-10-05T09:00:00.000Z",
    });
    assert.equal(other.created, true);
  });

  it("lead diversi non si bloccano a vicenda", async () => {
    await db.scheduleFollowup({ lead_id: "lead-1", title: "Richiamare", due_at: due });
    const other = await db.scheduleFollowup({ lead_id: "lead-2", title: "Richiamare", due_at: due });
    assert.equal(other.created, true);
  });

  it("chiuderne uno lo toglie dagli aperti", async () => {
    const res = await db.scheduleFollowup({ lead_id: "lead-1", title: "Richiamare", due_at: due });
    await db.completeFollowup(res.id);
    assert.equal((await db.listFollowups({ onlyOpen: true })).length, 0);
    assert.equal((await db.listFollowups({ leadId: "lead-1" })).length, 1, "riga cancellata invece di chiusa");
  });

  it("gli aperti sono ordinati per scadenza", async () => {
    await db.scheduleFollowup({ lead_id: "l", title: "tardi", due_at: "2026-12-01T09:00:00.000Z" });
    await db.scheduleFollowup({ lead_id: "l", title: "presto", due_at: "2026-10-01T09:00:00.000Z" });
    const items = await db.listFollowups({ onlyOpen: true });
    assert.equal(items[0].title, "presto");
  });

  it("la chiave di dedup normalizza spazi e maiuscole", () => {
    assert.equal(
      db.followupDedupKey("l1", "  Richiamare   il   Titolare ", "2026-10-01T09:00:00Z"),
      db.followupDedupKey("l1", "richiamare il titolare", "2026-10-01T23:59:00Z"),
    );
  });
});

describe("demo_views", () => {
  it("registra un'apertura senza identificare nessuno", async () => {
    const project = await db.getOrCreateProject("lead-1");
    await db.recordDemoView({
      forge_project_id: project!.id,
      lead_id: "lead-1",
      device: "mobile",
    });
    const views = await db.listDemoViews(project!.id);
    assert.equal(views.length, 1);
    assert.equal(views[0].device, "mobile");
    // Nessun campo che possa identificare la persona: solo aggregato.
    assert.deepEqual(Object.keys(views[0]).sort(), [
      "cta_clicked",
      "device",
      "forge_project_id",
      "id",
      "lead_id",
      "viewed_at",
    ]);
  });

  it("un device sconosciuto diventa desktop, non finisce grezzo sul DB", async () => {
    const project = await db.getOrCreateProject("lead-1");
    await db.recordDemoView({
      forge_project_id: project!.id,
      lead_id: "lead-1",
      device: "<script>alert(1)</script>",
    });
    assert.equal((await db.listDemoViews(project!.id))[0].device, "desktop");
  });
});
