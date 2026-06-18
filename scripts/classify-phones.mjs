// ============================================================
// Retroattivo: classifica i numeri di TUTTI i lead (mobile/fisso) e
// salva leads.meta.phone_type. Riporta in pipeline i lead archiviati
// SOLO perché fissi (ora si chiamano, non si buttano). Idempotente.
//   node scripts/classify-phones.mjs
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

/** Mirror di lib/pitch.classifyPhone. */
function classifyPhone(raw) {
  if (!raw) return "";
  let d = String(raw).replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0039")) d = d.slice(4);
  else if (d.startsWith("39") && d.length >= 11) d = d.slice(2);
  if (d.startsWith("3")) return "mobile";
  if (d.startsWith("0")) return "fisso";
  return "";
}

const leads = await db.execute("SELECT id, phone, meta FROM leads");
let mobile = 0, fisso = 0, ignoto = 0, updated = 0;

for (const r of leads.rows) {
  const id = str(r.id);
  const type = classifyPhone(str(r.phone));
  if (type === "mobile") mobile++;
  else if (type === "fisso") fisso++;
  else ignoto++;

  let meta = {};
  try { meta = JSON.parse(str(r.meta) || "{}"); } catch { /* ignore */ }
  if (meta.phone_type !== type) {
    if (type === "") delete meta.phone_type;
    else meta.phone_type = type;
    await db.execute({
      sql: "UPDATE leads SET meta = ?, updated_at = datetime('now') WHERE id = ?",
      args: [JSON.stringify(meta), id],
    });
    updated++;
  }
}

// Riporta in pipeline i lead archiviati SOLO perché numero fisso.
const FISSO_REASONS = [
  "numero fisso: non raggiungibile su WhatsApp",
  "numero fisso: chiama",
];
const placeholders = FISSO_REASONS.map(() => "?").join(",");
const unarchive = await db.execute({
  sql: `UPDATE autopilot_pipeline
        SET stage = 'da_contattare', archived_reason = '',
            next_action = CASE WHEN next_action IS NULL OR next_action = '' THEN 'numero fisso: chiama' ELSE next_action END,
            updated_at = datetime('now')
        WHERE stage = 'archiviato' AND archived_reason IN (${placeholders})`,
  args: FISSO_REASONS,
});

console.log("\n================ CLASSIFICAZIONE NUMERI ================");
console.log(`  lead totali        : ${leads.rows.length}`);
console.log(`  📱 MOBILE (WA-abili): ${mobile}`);
console.log(`  ☎  FISSO (chiama)   : ${fisso}`);
console.log(`  ?  non determinabile: ${ignoto}`);
console.log(`  ------------------------------------`);
console.log(`  phone_type aggiornati: ${updated}`);
console.log(`  fissi ri-portati in pipeline (da archiviato): ${unarchive.rowsAffected ?? 0}`);
console.log("=======================================================");
console.log(`\n➡  Outreach WhatsApp possibile su ${mobile} lead. Gli altri ${fisso} fissi si lavorano a telefono.`);
process.exit(0);
