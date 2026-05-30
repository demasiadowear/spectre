// Wipe all test/demo data from Turso, keeping the schema intact.
// Backs up every row to backup_test_data.json before deleting.
// Credentials are read from .env.local (never printed).
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";

// --- load Turso creds from .env.local ---
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*(TURSO_[A-Z_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}
const url = env.TURSO_DATABASE_URL;
const authToken = env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in .env.local");
  process.exit(1);
}

const client = createClient({ url, authToken });

// Only data tables — NOT the schema. (No shadow_data table exists.)
const TABLES = ["leads", "interactions", "proposals", "ai_logs", "mind_graph"];

async function counts(label) {
  console.log(`\n${label}`);
  const out = {};
  for (const t of TABLES) {
    const r = await client.execute(`SELECT COUNT(*) AS n FROM ${t}`);
    out[t] = Number(r.rows[0].n);
    console.log(`  ${t}: ${out[t]}`);
  }
  return out;
}

// 1. Snapshot every row for the backup.
const backup = { takenAt: new Date().toISOString(), tables: {} };
for (const t of TABLES) {
  const r = await client.execute(`SELECT * FROM ${t}`);
  backup.tables[t] = r.rows;
}
writeFileSync("backup_test_data.json", JSON.stringify(backup, null, 2));
console.log("Backup -> backup_test_data.json");

await counts("=== PRIMA ===");

// 2. Delete (children before parent; FK cascade would also cover it).
await client.batch(
  [
    "DELETE FROM ai_logs",
    "DELETE FROM mind_graph",
    "DELETE FROM proposals",
    "DELETE FROM interactions",
    "DELETE FROM leads",
  ],
  "write",
);

const after = await counts("=== DOPO ===");

const dirty = Object.values(after).some((n) => n > 0);
console.log(dirty ? "\nATTENZIONE: tabelle non vuote." : "\nDB pulito. 0 record ovunque.");
process.exit(dirty ? 1 : 0);
