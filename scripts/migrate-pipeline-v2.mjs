// ============================================================
// Migrazione Pipeline v2 (Visor+Autopilot fusi, macchina a stati unica).
// Idempotente. Esegui UNA volta dopo il deploy del codice nuovo:
//   node scripts/migrate-pipeline-v2.mjs
//
// A) rimappa autopilot_pipeline.stage (vecchi 14 stati -> nuovi 7),
//    preservando il dettaglio (demo/richiamo/prezzo) in next_action
// B) backfill: ogni lead senza riga pipeline entra in pipeline
// C) DROP tabelle morte (ai_logs, mind_graph, autopilot_counters)
// D) purge righe worker da autopilot_settings
// La colonna tier resta intatta (storico). proposals NON si tocca (Hand).
// ============================================================
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const str = (v) => (v == null ? "" : String(v));

// ----- A) Rimappa gli stage -----------------------------------
// from (vecchio) -> { to (nuovo), action (default next_action se vuoto) }
const REMAP = [
  { from: "nuovo", to: "da_contattare", action: null },
  { from: "studiato", to: "da_contattare", action: null },
  { from: "risposto_manuale", to: "ha_risposto", action: null },
  { from: "demo_richiesta", to: "in_trattativa", action: "demo da fare" },
  { from: "demo_inviata", to: "in_trattativa", action: "demo inviata, attesa risposta" },
  { from: "da_chiamare", to: "in_trattativa", action: "richiamare" },
  { from: "richiesta_prezzo", to: "in_trattativa", action: "mandare il prezzo" },
  { from: "tiepido", to: "in_trattativa", action: "tiepido: ricontattare" },
  { from: "escalation", to: "in_trattativa", action: "serve gestione manuale" },
];

console.log("\n== A) rimappa stage ==");
for (const { from, to, action } of REMAP) {
  const before = Number(
    (await db.execute({ sql: "SELECT COUNT(*) n FROM autopilot_pipeline WHERE stage = ?", args: [from] })).rows[0].n,
  );
  if (before === 0) continue;
  if (action) {
    await db.execute({
      sql: `UPDATE autopilot_pipeline
            SET stage = ?,
                next_action = CASE WHEN next_action IS NULL OR next_action = '' THEN ? ELSE next_action END,
                updated_at = datetime('now')
            WHERE stage = ?`,
      args: [to, action, from],
    });
  } else {
    await db.execute({
      sql: "UPDATE autopilot_pipeline SET stage = ?, updated_at = datetime('now') WHERE stage = ?",
      args: [to, from],
    });
  }
  console.log(`  ${from} -> ${to}: ${before} righe`);
}

// ----- B) Backfill lead orfani --------------------------------
const STATUS_TO_STAGE = {
  todo: "da_contattare",
  step1_sent: "contattato",
  replied: "ha_risposto",
  step2_sent: "in_trattativa",
  preview_sent: "in_trattativa",
  negotiating: "in_trattativa",
  closed: "vinto",
  lost: "perso",
};

console.log("\n== B) backfill lead senza riga pipeline ==");
const orphans = await db.execute(
  `SELECT id, status, meta FROM leads
   WHERE id NOT IN (SELECT lead_id FROM autopilot_pipeline)`,
);
let inserted = 0;
for (const r of orphans.rows) {
  const id = str(r.id);
  let meta = {};
  try { meta = JSON.parse(str(r.meta) || "{}"); } catch { /* ignore */ }
  const stage = STATUS_TO_STAGE[str(r.status)] ?? "da_contattare";
  const category = str(meta.category) || "attività";
  // city: ultima parte dell'indirizzo, altrimenti "zona" (lo Study risolve)
  const addr = str(meta.address);
  const city = addr.includes(",") ? addr.split(",").pop().trim() : "zona";
  await db.execute({
    sql: `INSERT OR IGNORE INTO autopilot_pipeline (lead_id, stage, tier, place_id, category, city)
          VALUES (?, ?, '', NULL, ?, ?)`,
    args: [id, stage, category, city || "zona"],
  });
  inserted++;
}
console.log(`  backfillati ${inserted} lead in pipeline`);

// ----- C) DROP tabelle morte ----------------------------------
console.log("\n== C) drop tabelle morte ==");
for (const t of ["ai_logs", "mind_graph", "autopilot_counters"]) {
  await db.execute(`DROP TABLE IF EXISTS ${t}`);
  console.log(`  DROP ${t}`);
}

// ----- D) purge settings worker -------------------------------
console.log("\n== D) purge settings worker ==");
const WORKER_KEYS = [
  "kill_switch", "warmup_started_at", "warmup_daily_cap", "steady_daily_cap",
  "warmup_days", "bot_conversational", "worker_heartbeat", "worker_wa_ready",
  "agenda_reminder_day",
];
for (const k of WORKER_KEYS) {
  await db.execute({ sql: "DELETE FROM autopilot_settings WHERE key = ?", args: [k] });
}
console.log(`  rimosse ${WORKER_KEYS.length} chiavi worker`);

// ----- Riepilogo ----------------------------------------------
console.log("\n== stato finale: pipeline per stage ==");
const fin = await db.execute("SELECT stage, COUNT(*) n FROM autopilot_pipeline GROUP BY stage ORDER BY n DESC");
for (const x of fin.rows) console.log(`  ${str(x.stage).padEnd(16)} ${x.n}`);
const tot = await db.execute("SELECT COUNT(*) n FROM leads");
const pip = await db.execute("SELECT COUNT(*) n FROM autopilot_pipeline");
console.log(`\n  leads ${str(tot.rows[0].n)} · pipeline ${str(pip.rows[0].n)} (devono coincidere dopo il backfill)`);
console.log("\n✅ migrazione completata.");
process.exit(0);
