// One-off: applica lib/detective/schema.sql (estensione DETECTIVE) al DB
// Turso esistente di SPECTER, poi verifica. Pattern di setup-autopilot.mjs:
// nessuna tabella esistente viene toccata.
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
const schema = readFileSync(
  join(here, "..", "lib", "detective", "schema.sql"),
  "utf8",
);

const client = createClient({ url, authToken });

console.log("Applying Detective schema extension…");
await client.executeMultiple(schema);

const res = await client.execute("SELECT COUNT(*) AS n FROM detective_cases");
console.log(`  detective_cases: ${res.rows[0].n} rows`);

console.log("Detective schema OK.");
