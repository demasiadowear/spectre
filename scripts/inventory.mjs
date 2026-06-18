// Inventario read-only: tabelle, righe, ultimo timestamp. Nessuna scrittura.
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const tablesRes = await db.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' ORDER BY name",
);
const tables = tablesRes.rows.map((r) => String(r.name));

const TIME_COLS = ["updated_at", "created_at", "demo_sent_at", "contacted_at"];

for (const t of tables) {
  let count = "?";
  try {
    count = String((await db.execute(`SELECT COUNT(*) n FROM "${t}"`)).rows[0].n);
  } catch (e) {
    console.log(`${t.padEnd(26)} ERR ${e.message}`);
    continue;
  }
  // colonne della tabella
  const cols = (await db.execute(`PRAGMA table_info("${t}")`)).rows.map((c) => String(c.name));
  let timeCol = TIME_COLS.find((c) => cols.includes(c));
  let last = "";
  if (timeCol && count !== "0") {
    try {
      last = String((await db.execute(`SELECT MAX("${timeCol}") m FROM "${t}"`)).rows[0].m ?? "");
    } catch {
      /* ignore */
    }
  }
  console.log(`${t.padEnd(26)} righe=${count.padEnd(6)} ${timeCol ? `ultimo ${timeCol}=${last}` : "(no timestamp)"}`);
}

// Dettaglio leads: distribuzione per status (vista Visor/funnel)
console.log("\n--- leads per status ---");
try {
  const r = await db.execute("SELECT status, COUNT(*) n FROM leads GROUP BY status ORDER BY n DESC");
  for (const x of r.rows) console.log(`  ${String(x.status).padEnd(16)} ${x.n}`);
} catch (e) { console.log("  (no leads)", e.message); }

// Dettaglio autopilot_pipeline per stage
console.log("\n--- autopilot_pipeline per stage ---");
try {
  const r = await db.execute("SELECT stage, COUNT(*) n FROM autopilot_pipeline GROUP BY stage ORDER BY n DESC");
  for (const x of r.rows) console.log(`  ${String(x.stage).padEnd(18)} ${x.n}`);
} catch (e) { console.log("  (no pipeline)", e.message); }

// leads con coordinate (Territorio) e con meta rating (qualità)
console.log("\n--- segnali vari ---");
try {
  const geo = await db.execute("SELECT COUNT(*) n FROM leads WHERE meta LIKE '%\"lat\"%' OR meta LIKE '%latitude%'");
  console.log("  leads con coordinate (Territorio):", String(geo.rows[0].n));
} catch (e) { console.log("  geo err", e.message); }
try {
  const rat = await db.execute("SELECT COUNT(*) n FROM leads WHERE meta LIKE '%\"rating\"%'");
  console.log("  leads con rating Google (qualità):", String(rat.rows[0].n));
} catch (e) { console.log("  rating err", e.message); }

process.exit(0);
