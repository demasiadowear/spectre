// One-off Turso provisioning: applies lib/turso/schema.sql (schema + seed)
// to the remote DB, then verifies tables and row counts.
// Credentials are read from env (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN) —
// never hardcoded, never printed.
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
const schemaPath = join(here, "..", "lib", "turso", "schema.sql");
const schema = readFileSync(schemaPath, "utf8");

const client = createClient({ url, authToken });

console.log("Applying schema + seed…");
await client.executeMultiple(schema);

const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
);
console.log(
  "Tables:",
  tables.rows.map((r) => r.name).join(", "),
);

for (const t of ["leads", "interactions", "mind_graph", "proposals", "ai_logs"]) {
  const res = await client.execute(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(`  ${t}: ${res.rows[0].n} rows`);
}

console.log("Turso provisioning OK.");
