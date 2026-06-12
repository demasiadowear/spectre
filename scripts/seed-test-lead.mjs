// Lead di TEST per l'e2e del flusso risposte (numero di Puccio).
// Il worker tratta il numero di Puccio come lead SOLO se la riga ha
// meta.test = true (vedi isTestLead in worker/index.mjs).
//
//   node scripts/seed-test-lead.mjs            # crea/ripristina il lead test
//   node scripts/seed-test-lead.mjs --clean    # lo rimuove del tutto
//
// PROCEDURA E2E (worker + runner accesi, dal telefono personale):
//   1. invia al numero AYROMEX un finto auto-reply:
//        "Grazie per averci contattato! Vi risponderemo al più presto."
//      ATTESO: nessuna notifica; entro pochi secondi arriva il messaggio
//      di sblocco (bypass_autoreply). Un secondo auto-reply NON deve
//      produrre un secondo sblocco.
//   2. invia una risposta umana: "Sì mi interessa, di che si tratta?"
//      ATTESO: notifica WA+dashboard entro 60s, lead in
//      "risposto — manuale", bot muto da lì in poi.
//   3. dashboard -> drawer del lead -> "Segna demo richiesta", poi
//      incolla un link qualsiasi (https://...) e "Approva e invia".
//      ATTESO: il worker manda il messaggio demo_ready col link al
//      prossimo tick. SPECTRE non builda nulla: la demo è tua.
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in env.");
  process.exit(1);
}

const PHONE = process.env.TEST_LEAD_PHONE ?? "393492301150"; // Puccio
const LEAD_ID = "test-lead-puccio";
const db = createClient({ url, authToken });

if (process.argv.includes("--clean")) {
  await db.execute({ sql: "DELETE FROM wa_messages WHERE lead_id = ?", args: [LEAD_ID] });
  await db.execute({ sql: "DELETE FROM autopilot_pipeline WHERE lead_id = ?", args: [LEAD_ID] });
  await db.execute({ sql: "DELETE FROM leads WHERE id = ?", args: [LEAD_ID] });
  console.log("Lead test rimosso.");
  process.exit(0);
}

// Lead CRM (meta.test = true è la chiave che sblocca il numero di Puccio).
await db.execute({
  sql: `INSERT INTO leads (id, name, company, phone, source, status, value, meta)
        VALUES (?, ?, ?, ?, 'cold', 'step1_sent', 499, ?)
        ON CONFLICT(id) DO UPDATE SET phone = excluded.phone, meta = excluded.meta`,
  args: [
    LEAD_ID,
    "Puccio Test",
    "TEST Salone Puccio",
    PHONE,
    JSON.stringify({
      test: true,
      rating: 4.9,
      reviews: 120,
      address: "Via del Test 1, Bari",
    }),
  ],
});

// Pipeline: stage "contattato" come un lead reale dopo l'outreach.
// bypass_sent_at NULL -> lo sblocco auto-reply è pronto a scattare.
await db.execute({
  sql: `INSERT INTO autopilot_pipeline
          (lead_id, stage, tier, category, city, approval_status, contacted_at, bot_paused)
        VALUES (?, 'contattato', 'T1', 'parrucchiere', 'Bari', 'approved', datetime('now'), 0)
        ON CONFLICT(lead_id) DO UPDATE SET
          stage = 'contattato', bot_paused = 0, bypass_sent_at = NULL,
          demo_url = NULL, demo_sent_at = NULL,
          followup1_at = NULL, followup2_at = NULL,
          archived_reason = '', escalation_reason = '',
          contacted_at = datetime('now'), updated_at = datetime('now')`,
  args: [LEAD_ID],
});

// Outreach finto in chat: serve storia coerente (e una base per
// l'euristica di latenza). Datato 10 minuti fa.
await db.execute({ sql: "DELETE FROM wa_messages WHERE lead_id = ?", args: [LEAD_ID] });
await db.execute({
  sql: `INSERT INTO wa_messages (id, lead_id, direction, body, status, wa_id, ai_generated, created_at)
        VALUES (?, ?, 'out', ?, 'delivered', '', 0, datetime('now', '-10 minutes'))`,
  args: [
    `wa-${randomUUID()}`,
    LEAD_ID,
    "Buongiorno! Ho visto che avete 4.9 stelle su Google, complimenti davvero. Vi va di vedere una demo gratuita del vostro sito? Ramona, AYROMEX",
  ],
});

console.log(`Lead test pronto: ${LEAD_ID} (${PHONE}), stage "contattato".`);
console.log("Ora scrivi dal telefono al numero WA AYROMEX seguendo la procedura nel commento in testa al file.");
