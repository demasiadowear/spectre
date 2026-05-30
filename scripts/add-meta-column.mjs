// Idempotent migration: add the `meta` JSON column to `leads` if missing.
// Safe to run repeatedly. Uso: node scripts/add-meta-column.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const pick = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] ?? "").trim();
const db = createClient({
  url: pick("TURSO_DATABASE_URL"),
  authToken: pick("TURSO_AUTH_TOKEN"),
});

const cols = await db.execute("PRAGMA table_info(leads)");
const hasMeta = cols.rows.some((r) => r.name === "meta");

if (hasMeta) {
  console.log("Colonna 'meta' già presente — nessuna modifica.");
} else {
  await db.execute("ALTER TABLE leads ADD COLUMN meta TEXT DEFAULT '{}'");
  console.log("Colonna 'meta' aggiunta a leads.");
}

// Normalizza eventuali stati legacy → funnel (sicuro, idempotente).
const remap = {
  cold: "todo",
  warm: "step1_sent",
  hot: "preview_sent",
  proposal: "preview_sent",
  negotiation: "negotiating",
};
for (const [oldS, newS] of Object.entries(remap)) {
  const r = await db.execute({
    sql: "UPDATE leads SET status = ? WHERE status = ?",
    args: [newS, oldS],
  });
  if (r.rowsAffected) console.log(`  status ${oldS} → ${newS}: ${r.rowsAffected} righe`);
}
console.log("Migration completata.");
