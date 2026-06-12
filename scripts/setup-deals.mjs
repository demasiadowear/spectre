// One-off: stati trattativa manuali + agenda + promemoria (12/06/2026).
// Idempotente, pattern setup-classifier.mjs.
//   - colonne autopilot_pipeline: next_action, next_action_at, lost_reason
//   - template agenda_reminder (digest WA mattutino a Puccio)
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in env.");
  process.exit(1);
}

const client = createClient({ url, authToken });

const cols = await client.execute("PRAGMA table_info(autopilot_pipeline)");
const names = new Set(cols.rows.map((r) => String(r.name)));
for (const col of ["next_action", "next_action_at", "lost_reason"]) {
  if (names.has(col)) {
    console.log(`${col}: già presente, skip.`);
  } else {
    await client.execute(`ALTER TABLE autopilot_pipeline ADD COLUMN ${col} text`);
    console.log(`${col}: colonna aggiunta.`);
  }
}

const res = await client.execute({
  sql: `INSERT INTO message_templates (key, label, content, variables)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO NOTHING`,
  args: [
    "agenda_reminder",
    "Notifica Puccio · agenda azioni del giorno",
    "📅 AGENDA OGGI\n{LISTA}",
    JSON.stringify(["{LISTA}"]),
  ],
});
console.log(
  res.rowsAffected > 0
    ? "agenda_reminder: template seedato."
    : "agenda_reminder: già presente.",
);

console.log("Migrazione stati trattativa OK.");
