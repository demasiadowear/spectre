// ============================================================
// Migrazione: aggiunge autopilot_pipeline.wa_variant (A/B test del
// primo messaggio WA). Idempotente: salta se la colonna esiste già.
//   node scripts/add-wa-variant-column.mjs
// Credenziali da .env.local (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN).
// ============================================================
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const cols = await db.execute("PRAGMA table_info(autopilot_pipeline)");
const has = cols.rows.some((r) => String(r.name) === "wa_variant");

if (has) {
  console.log("wa_variant già presente: niente da fare.");
} else {
  await db.execute("ALTER TABLE autopilot_pipeline ADD COLUMN wa_variant text default ''");
  console.log("✅ colonna wa_variant aggiunta ad autopilot_pipeline.");
}
process.exit(0);
