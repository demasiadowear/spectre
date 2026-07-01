// One-off: applica lib/autopilot/schema.sql (estensione Pipeline) al DB
// Turso esistente di SPECTRE, poi verifica le tabelle. Idempotente:
// safe da rieseguire anche su un DB già migrato a Pipeline v2.
// Credenziali da env (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in env.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "lib", "autopilot", "schema.sql");
const schema = readFileSync(schemaPath, "utf8");

const client = createClient({ url, authToken });

console.log("Applying Autopilot schema extension…");
await client.executeMultiple(schema);

const tables = ["autopilot_pipeline", "wa_messages", "autopilot_alerts"];
for (const t of tables) {
  const res = await client.execute(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(`  ${t}: ${res.rows[0].n} rows`);
}

const cols = await client.execute("PRAGMA table_info(autopilot_pipeline)");
const names = new Set(cols.rows.map((r) => String(r.name)));
const required = ["next_action", "next_action_at", "lost_reason"];
const missing = required.filter((c) => !names.has(c));
console.log(
  missing.length === 0
    ? "Colonne trattativa (next_action/next_action_at/lost_reason): OK."
    : `⚠ colonne mancanti (DB pre-esistente non aggiornato): ${missing.join(", ")}`,
);

console.log("Pipeline schema OK.");
