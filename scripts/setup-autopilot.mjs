// One-off: applica lib/autopilot/schema.sql (estensione Autopilot) al DB
// Turso esistente di SPECTRE, poi verifica tabelle e settings di default.
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

const tables = [
  "autopilot_pipeline",
  "wa_messages",
  "autopilot_builds",
  "autopilot_settings",
  "autopilot_counters",
  "autopilot_alerts",
];
for (const t of tables) {
  const res = await client.execute(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(`  ${t}: ${res.rows[0].n} rows`);
}

const settings = await client.execute(
  "SELECT key, value FROM autopilot_settings ORDER BY key",
);
console.log("Settings:");
for (const r of settings.rows) console.log(`  ${r.key} = ${r.value}`);

console.log("Autopilot schema OK.");
