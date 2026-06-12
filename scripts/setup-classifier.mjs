// One-off: migrazione per il classificatore risposte a 3 vie.
// Pattern di setup-templates.mjs: idempotente, nessun dato toccato.
//   - colonna autopilot_pipeline.bypass_sent_at (sblocco auto-reply, max 1)
//   - setting bot_conversational = '0' (bot conversazionale OFF)
//   - template bypass_autoreply + human_reply_notify (seed, mai sovrascritti)
//   - demo_request_notify aggiornato SOLO se ha ancora il testo default
//     vecchio ("Build automatica in coda" non è più vero: build solo manuale)
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in env.");
  process.exit(1);
}

const client = createClient({ url, authToken });

// ----- 1. colonna bypass_sent_at -----------------------------

const cols = await client.execute("PRAGMA table_info(autopilot_pipeline)");
const hasBypass = cols.rows.some((r) => String(r.name) === "bypass_sent_at");
if (hasBypass) {
  console.log("bypass_sent_at: già presente, skip.");
} else {
  await client.execute(
    "ALTER TABLE autopilot_pipeline ADD COLUMN bypass_sent_at text",
  );
  console.log("bypass_sent_at: colonna aggiunta.");
}

// ----- 2. flag bot conversazionale (OFF) ---------------------

await client.execute({
  sql: `INSERT INTO autopilot_settings (key, value) VALUES ('bot_conversational', '0')
        ON CONFLICT(key) DO NOTHING`,
  args: [],
});
console.log("bot_conversational: default OFF (se non già impostato).");

// ----- 3. nuovi template -------------------------------------

const TEMPLATES = [
  {
    key: "bypass_autoreply",
    label: "Sblocco auto-reply · unico messaggio dopo risponditore automatico",
    variables: ["{SALUTO}"],
    content:
      "{SALUTO} Posso parlare con il titolare o con chi si occupa della comunicazione? Ramona, AYROMEX",
  },
  {
    key: "human_reply_notify",
    label: "Notifica Puccio · risposta umana (bot muto, chat manuale)",
    variables: ["{NOME_ATTIVITA}", "{TELEFONO}", "{MESSAGGIO}", "{LINK_CHAT}"],
    content:
      "💬 RISPOSTA UMANA — {NOME_ATTIVITA} ({TELEFONO})\n«{MESSAGGIO}»\n\nIl bot è muto su questa chat: rispondi tu.\nChat: {LINK_CHAT}",
  },
];

let inserted = 0;
for (const t of TEMPLATES) {
  const res = await client.execute({
    sql: `INSERT INTO message_templates (key, label, content, variables)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO NOTHING`,
    args: [t.key, t.label, t.content, JSON.stringify(t.variables)],
  });
  inserted += res.rowsAffected;
}
console.log(`template nuovi: ${inserted}/${TEMPLATES.length} seedati.`);

// ----- 4. demo_request_notify: via il "build automatica" ------

const OLD_DEMO_NOTIFY =
  "✅ DEMO RICHIESTA — {NOME_ATTIVITA} ({CITTA}). Build automatica in coda.";
const NEW_DEMO_NOTIFY =
  "✅ DEMO RICHIESTA — {NOME_ATTIVITA} ({CITTA}). Genera la demo dal bottone in dashboard.";
const upd = await client.execute({
  sql: `UPDATE message_templates SET content = ? WHERE key = 'demo_request_notify' AND content = ?`,
  args: [NEW_DEMO_NOTIFY, OLD_DEMO_NOTIFY],
});
console.log(
  upd.rowsAffected > 0
    ? "demo_request_notify: testo aggiornato (build solo manuale)."
    : "demo_request_notify: testo personalizzato, non toccato.",
);

console.log("Migrazione classificatore OK.");
