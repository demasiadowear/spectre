// One-off: triage automatico risposte umane (12/06/2026). Idempotente.
// La notifica human_reply_notify ora include lo stato assegnato
// ({STATO}); aggiornata SOLO se ha ancora il testo default.
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in env.");
  process.exit(1);
}

const client = createClient({ url, authToken });

const OLD =
  "💬 RISPOSTA UMANA — {NOME_ATTIVITA} ({TELEFONO})\n«{MESSAGGIO}»\n\nIl bot è muto su questa chat: rispondi tu.\nChat: {LINK_CHAT}";
const NEW =
  "💬 RISPOSTA UMANA — {NOME_ATTIVITA} ({TELEFONO})\n«{MESSAGGIO}»\n\nSmistato in: {STATO}\nIl bot è muto su questa chat: rispondi tu.\nChat: {LINK_CHAT}";

const upd = await client.execute({
  sql: `UPDATE message_templates
        SET content = ?, variables = ?
        WHERE key = 'human_reply_notify' AND content = ?`,
  args: [
    NEW,
    JSON.stringify(["{NOME_ATTIVITA}", "{TELEFONO}", "{MESSAGGIO}", "{STATO}", "{LINK_CHAT}"]),
    OLD,
  ],
});
console.log(
  upd.rowsAffected > 0
    ? "human_reply_notify: aggiunto {STATO} (smistamento triage)."
    : "human_reply_notify: testo personalizzato, non toccato — aggiungi {STATO} a mano da /templates se lo vuoi.",
);
console.log("Migrazione triage OK.");
