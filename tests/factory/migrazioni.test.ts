import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";

import {
  aggiungiColonne, colonneDi, tabellaEsiste,
} from "../../lib/factory/migrazioni";

// ============================================================
// Le migrazioni, su database libSQL veri.
//
// La versione precedente faceva partire l'ALTER e catturava
// «no such table». Il difetto non era il catch: era che quel messaggio
// lo producono TRE cose diverse — una tabella opzionale assente, un
// nome sbagliato, uno schema mai applicato — e tutte e tre venivano
// ignorate allo stesso modo, lasciando uno schema aggiornato a meta.
//
// Ogni test qui usa un file suo, cosi uno non sporca l'altro.
// ============================================================

const DIR = mkdtempSync(join(tmpdir(), "spectre-mig-"));
let n = 0;
const nuovoDb = (): Client => createClient({ url: `file:${join(DIR, `m${++n}.db`)}` });

after(() => { rmSync(DIR, { recursive: true, force: true }); });

const COLONNE = [
  { nome: "website_status", definizione: "text default ''" },
  { nome: "website_opportunity_score", definizione: "integer not null default 0" },
  { nome: "factory_stage", definizione: "text default ''" },
];

// ----- 1. tabella presente -> colonne aggiunte -------------------

test("1. tabella presente: le colonne mancanti vengono aggiunte", async () => {
  const db = nuovoDb();
  await db.execute("create table autopilot_pipeline (lead_id text primary key, place_id text)");

  const r = await aggiungiColonne(db, "autopilot_pipeline", COLONNE);

  assert.equal(r.esito, "applicata");
  assert.deepEqual(r.aggiunte.sort(), COLONNE.map((c) => c.nome).sort());
  assert.deepEqual(r.gia_presenti, []);

  // E ci sono davvero: il rapporto non basta, si guarda la tabella.
  const col = await colonneDi(db, "autopilot_pipeline");
  for (const c of COLONNE) {
    assert.ok(col.indexOf(c.nome) !== -1, `${c.nome} non e stata aggiunta`);
  }
  // Le colonne preesistenti restano.
  assert.ok(col.indexOf("lead_id") !== -1);
  assert.ok(col.indexOf("place_id") !== -1);
});

test("1b. una tabella con ALCUNE colonne gia presenti aggiunge solo il resto", async () => {
  const db = nuovoDb();
  await db.execute("create table autopilot_pipeline (lead_id text primary key, website_status text default '')");

  const r = await aggiungiColonne(db, "autopilot_pipeline", COLONNE);

  assert.equal(r.esito, "applicata");
  assert.deepEqual(r.gia_presenti, ["website_status"]);
  assert.deepEqual(r.aggiunte.sort(), ["factory_stage", "website_opportunity_score"]);
});

// ----- 2. colonne gia presenti -> tollerato ----------------------

test("2. rieseguire la migrazione non fa niente e non fallisce", async () => {
  const db = nuovoDb();
  await db.execute("create table autopilot_pipeline (lead_id text primary key)");

  const primo = await aggiungiColonne(db, "autopilot_pipeline", COLONNE);
  assert.equal(primo.esito, "applicata");

  const secondo = await aggiungiColonne(db, "autopilot_pipeline", COLONNE);
  assert.equal(secondo.esito, "gia_applicata");
  assert.deepEqual(secondo.aggiunte, []);
  assert.deepEqual(secondo.gia_presenti.sort(), COLONNE.map((c) => c.nome).sort());
});

test("2b. duplicate column resta tollerata anche in corsa", async () => {
  // Due processi che migrano insieme: uno legge le colonne, l'altro
  // aggiunge, e il primo si trova l'ALTER gia fatto. E l'unico caso in
  // cui un errore sull'ALTER e normale.
  const db = nuovoDb();
  await db.execute("create table autopilot_pipeline (lead_id text primary key)");
  const esiti = await Promise.all([
    aggiungiColonne(db, "autopilot_pipeline", COLONNE),
    aggiungiColonne(db, "autopilot_pipeline", COLONNE),
  ]);
  for (const r of esiti) {
    assert.ok(r.esito === "applicata" || r.esito === "gia_applicata", `esito ${r.esito}`);
  }
  const col = await colonneDi(db, "autopilot_pipeline");
  // Nessuna colonna doppia.
  assert.equal(new Set(col).size, col.length);
  for (const c of COLONNE) assert.ok(col.indexOf(c.nome) !== -1);
});

// ----- 3. tabella opzionale assente -> skip esplicito ------------

test("3. tabella OPZIONALE assente: skip dichiarato, non un errore ingoiato", async () => {
  const db = nuovoDb();
  assert.equal(await tabellaEsiste(db, "autopilot_pipeline"), false);

  const r = await aggiungiColonne(db, "autopilot_pipeline", COLONNE);

  assert.equal(r.esito, "migration_not_applicable",
    "l'assenza legittima deve essere uno stato, non un'eccezione catturata");
  assert.deepEqual(r.aggiunte, []);
  assert.match(r.motivo, /non presente/);
  assert.match(r.motivo, /autopilot_pipeline/);

  // E la tabella NON viene creata per sbaglio.
  assert.equal(await tabellaEsiste(db, "autopilot_pipeline"), false);
});

// ----- 4. tabella obbligatoria assente -> errore -----------------

test("4. tabella OBBLIGATORIA assente: la migrazione fallisce", async () => {
  const db = nuovoDb();
  await assert.rejects(
    () => aggiungiColonne(db, "tabella_che_serve", COLONNE, { obbligatoria: true }),
    (e: Error) => {
      assert.match(e.message, /obbligatoria/);
      assert.match(e.message, /tabella_che_serve/);
      assert.match(e.message, /schema canonico/);
      return true;
    },
    "una tabella obbligatoria che manca deve far fallire il deploy, non produrre uno schema a meta",
  );
});

// ----- 5. errore SQL o di connessione -> propagato ---------------

test("5a. un errore di sintassi nella definizione risale e non viene ingoiato", async () => {
  const db = nuovoDb();
  await db.execute("create table autopilot_pipeline (lead_id text primary key)");

  await assert.rejects(
    () => aggiungiColonne(db, "autopilot_pipeline", [
      { nome: "buona", definizione: "text default ''" },
      { nome: "rotta", definizione: "questo-non-e-un-tipo!!" },
    ]),
    (e: Error) => {
      assert.ok(!/duplicate column/i.test(e.message), "non e un duplicate column");
      return true;
    },
  );

  // La colonna valida PRIMA dell'errore e stata applicata, e quella
  // rotta no: lo schema e parziale, ed e per questo che l'errore deve
  // risalire invece di essere ingoiato.
  const col = await colonneDi(db, "autopilot_pipeline");
  assert.ok(col.indexOf("buona") !== -1);
  assert.ok(col.indexOf("rotta") === -1);
});

test("5b. un errore di connessione risale", async () => {
  const db = createClient({ url: `file:${join(DIR, "chiuso.db")}` });
  await db.execute("create table autopilot_pipeline (lead_id text primary key)");
  db.close();

  await assert.rejects(
    () => aggiungiColonne(db, "autopilot_pipeline", COLONNE),
    (e: Error) => {
      assert.ok(!/duplicate column/i.test(e.message));
      assert.ok(!/non presente/i.test(e.message),
        "un guasto di connessione non deve essere scambiato per una tabella assente");
      return true;
    },
  );
});

test("5c. «no such table» NON viene piu usato come controllo di flusso", async () => {
  // Il requisito: solo `duplicate column` e tollerato. L'assenza di una
  // tabella si verifica prima, e questo test guarda il sorgente perche
  // e l'unico modo di impedire che il catch largo torni.
  const { readFileSync } = await import("node:fs");
  // Si guarda il CODICE, non i commenti: la spiegazione del perche non
  // si usa piu contiene la frase, ed e giusto che la contenga.
  const senzaCommenti = (f: string) => readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const codice = senzaCommenti("lib/factory/migrazioni.ts") + senzaCommenti("lib/factory/db.ts");

  assert.ok(!/no such table/i.test(codice),
    "nessun ramo di codice deve riconoscere «no such table» per decidere cosa fare");
  assert.match(codice, /duplicate column/i,
    "e duplicate column deve restare l'unico errore tollerato");
  // L'esistenza si chiede, non si deduce.
  assert.match(codice, /sqlite_master/,
    "l'esistenza della tabella va verificata su sqlite_master");
});

// ----- Lo schema della curatela e SOLO additivo -----------------------
//
// Il rischio, qui, non e teorico: `ensureProposteSchema()` gira a ogni
// richiesta che tocca una proposta, su un database che in produzione ha
// gia dentro il lavoro di tutti i lead. Se una riga di quello schema
// fosse distruttiva, girerebbe da sola, senza che nessuno esegua una
// migrazione, e lo si scoprirebbe dopo.

test("curatela: lo schema non contiene nessuna istruzione distruttiva", () => {
  const src = readFileSync(join(__dirname, "..", "..", "lib", "demo", "proposte-db.ts"), "utf8");
  // Le istruzioni che possono togliere qualcosa a un database che ha
  // gia dei dati. `delete from` compreso: qui non si ripulisce niente.
  // `alter table ... add column` NON e in questo elenco: e additivo, ed
  // e l'unico modo di aggiungere una colonna a una tabella che in
  // produzione esiste gia. Cio che non deve esserci e tutto il resto.
  for (const proibita of [
    "drop table", "drop index", "drop column", "delete from",
    "truncate", "replace into", "alter table demo_proposte drop",
  ]) {
    assert.ok(
      !src.toLowerCase().includes(proibita),
      `«${proibita}» in lib/demo/proposte-db.ts: lo schema deve essere additivo`,
    );
  }
  // E cio che invece deve esserci: creazioni condizionate.
  assert.ok(src.includes("create table if not exists demo_proposte"));
  assert.ok(src.includes("create table if not exists demo_pubblicazioni"));
  assert.ok(src.includes("create index if not exists"));
  // E l'unico ALTER e un ADD COLUMN.
  for (const m of src.toLowerCase().match(/alter table[^;"'`]*/g) ?? []) {
    assert.match(m, /add column/, `ALTER non additivo: ${m}`);
  }
});

test("curatela: applicare lo schema due volte non cambia niente", async () => {
  const db = nuovoDb();
  const schema = `
    create table if not exists demo_proposte (project_id text primary key, lead_id text not null);
    create table if not exists demo_pubblicazioni (project_id text primary key, lead_id text not null);
  `;
  await db.executeMultiple(schema);
  await db.execute({
    sql: "insert into demo_proposte (project_id, lead_id) values (?, ?)",
    args: ["p1", "l1"],
  });
  // La seconda applicazione e quella che conta: e cio che succede a
  // ogni richiesta dopo un deploy.
  await db.executeMultiple(schema);
  const rs = await db.execute("select count(*) as n from demo_proposte");
  assert.equal(Number((rs.rows[0] as Record<string, unknown>).n), 1,
    "una riga esistente non deve sparire riapplicando lo schema");
  db.close();
});
