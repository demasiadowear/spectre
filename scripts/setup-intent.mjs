// One-off: applica lib/intent/schema.sql (Intent Scout) al DB Turso
// esistente di SPECTRE, poi verifica la tabella. Idempotente.
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
const schema = readFileSync(join(here, "..", "lib", "intent", "schema.sql"), "utf8");

const client = createClient({ url, authToken });

console.log("Applying Intent Scout schema extension…");
await client.executeMultiple(schema);

const res = await client.execute("SELECT COUNT(*) AS n FROM intent_pipeline");
console.log(`  intent_pipeline: ${res.rows[0].n} rows`);

const cols = await client.execute("PRAGMA table_info(intent_pipeline)");
const names = new Set(cols.rows.map((r) => String(r.name)));
const required = ["stage", "platform", "source_url", "score", "hook", "notified"];
const missing = required.filter((c) => !names.has(c));
console.log(
  missing.length === 0
    ? "Colonne intent_pipeline: OK."
    : `⚠ colonne mancanti: ${missing.join(", ")}`,
);
