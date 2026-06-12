// One-off: RIMOZIONE Stadio 3 (build demo automatica) — 12/06/2026.
// SPECTRE non builda nulla: le demo le prepara Puccio fuori e incolla
// il link in dashboard. Idempotente.
//   - colonne autopilot_pipeline.demo_url / demo_sent_at (invio manuale)
//   - DROP TABLE autopilot_builds (nessuna build automatica)
//   - via il template demo_ready_notify (notifica "demo deployata")
//   - demo_request_notify aggiornato SOLO se ha ancora il testo default
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in env.");
  process.exit(1);
}

const client = createClient({ url, authToken });

// ----- 1. colonne demo_url / demo_sent_at --------------------

const cols = await client.execute("PRAGMA table_info(autopilot_pipeline)");
const names = new Set(cols.rows.map((r) => String(r.name)));
for (const col of ["demo_url", "demo_sent_at"]) {
  if (names.has(col)) {
    console.log(`${col}: già presente, skip.`);
  } else {
    await client.execute(`ALTER TABLE autopilot_pipeline ADD COLUMN ${col} text`);
    console.log(`${col}: colonna aggiunta.`);
  }
}

// ----- 2. via la tabella delle build -------------------------

await client.execute("DROP TABLE IF EXISTS autopilot_builds");
console.log("autopilot_builds: tabella eliminata.");

// ----- 3. template -------------------------------------------

const del = await client.execute(
  "DELETE FROM message_templates WHERE key = 'demo_ready_notify'",
);
console.log(
  del.rowsAffected > 0
    ? "demo_ready_notify: template rimosso."
    : "demo_ready_notify: già assente.",
);

const OLD_DEMO_NOTIFY =
  "✅ DEMO RICHIESTA — {NOME_ATTIVITA} ({CITTA}). Genera la demo dal bottone in dashboard.";
const NEW_DEMO_NOTIFY =
  "✅ DEMO RICHIESTA — {NOME_ATTIVITA} ({CITTA}). Prepara la demo e incolla il link in dashboard.";
const upd = await client.execute({
  sql: "UPDATE message_templates SET content = ? WHERE key = 'demo_request_notify' AND content = ?",
  args: [NEW_DEMO_NOTIFY, OLD_DEMO_NOTIFY],
});
console.log(
  upd.rowsAffected > 0
    ? "demo_request_notify: testo aggiornato (demo manuale)."
    : "demo_request_notify: testo personalizzato, non toccato.",
);

console.log("Rimozione Stadio 3 OK.");
