// One-off: applica lib/templates/schema.sql (TEMPLATE MANAGER) al DB
// Turso esistente di SPECTER e fa il seed dei testi WA correnti.
// Pattern di setup-detective.mjs: nessuna tabella esistente toccata.
// Idempotente: ON CONFLICT DO NOTHING — le modifiche fatte da /templates
// NON vengono mai sovrascritte da una ri-esecuzione.
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

// ----- SEED = testi attuali Autopilot (al deploy nulla cambia) -----

const SEED = [
  {
    key: "study_wa_instructions",
    label: "Outreach A · istruzioni AI primo messaggio (stelle+demo)",
    variables: ["{SALUTO}"],
    content: `STRUTTURA FISSA, in quest'ordine:
   a) apertura: ESATTAMENTE il placeholder {SALUTO} — verrà sostituito al momento dell'invio con il saluto giusto per l'orario. MAI scrivere Buongiorno/Buon pomeriggio/Buonasera per esteso
   b) complimento con le stelle Google REALI del lead, prese dai campi "rating" e "recensioni_totali" dei dati (es. "ho visto che avete 4.9 stelle su Google, complimenti")
   c) gap positivo: con risultati così manca solo un sito all'altezza
   d) proposta: una demo del loro sito web TOTALMENTE GRATUITA, senza impegno
   e) chiusura: se vi piace, lo mettiamo online
   f) firma ESATTA: "Ramona, AYROMEX" (con la virgola, MAI il trattino)

Regole ferree per "wa_message":
- PUNTEGGIATURA UMANA: VIETATO il trattino lungo (—) e il trattino usato come inciso; solo virgole, punti e al massimo i due punti
- MASSIMO 3 frasi brevi, sotto i 250 caratteri totali (firma esclusa)
- rating e numero recensioni SOLO dai dati forniti, MAI inventati; se il numero recensioni è basso o mancante, cita solo le stelle; scrivi "oltre" solo se arrotondi il numero per difetto, mai col numero esatto
- NIENTE prezzo, niente link, niente preamboli, zero gergo marketing
- al massimo UNA emoji, e solo se naturale
- MAI la parola "Puccio"
- dai del voi/lei, tono caldo e diretto

Esempio del taglio giusto:
"{SALUTO} Ho visto che avete 4.9 stelle su Google con oltre 140 recensioni, complimenti davvero. Con risultati così, manca solo un sito all'altezza: vi va di vederne una demo gratuita, senza impegno? Se vi piace, lo mettiamo online. Ramona, AYROMEX"`,
  },
  {
    key: "outreach_variant_b",
    label: "Outreach B · primo messaggio statico (vuoto = non attivo)",
    variables: ["{SALUTO}", "{NOME_ATTIVITA}", "{COMPLIMENTO}"],
    content: "",
  },
  {
    key: "outreach_variant_c",
    label: "Outreach C · primo messaggio statico (vuoto = non attivo)",
    variables: ["{SALUTO}", "{NOME_ATTIVITA}", "{COMPLIMENTO}"],
    content: "",
  },
  {
    key: "followup_day3",
    label: "Follow-up giorno 3 (nessuna risposta)",
    variables: ["{SALUTO}", "{NOME_ATTIVITA}"],
    content:
      "{SALUTO} Le avevo scritto qualche giorno fa per {NOME_ATTIVITA}. La demo del sito è in lavorazione: le va se gliela mostro quando è pronta? Nessun impegno. Ramona, AYROMEX",
  },
  {
    key: "followup_day7",
    label: "Follow-up giorno 7 (ultimo messaggio)",
    variables: ["{NOME_ATTIVITA}"],
    content:
      "Ultimo messaggio, promesso 🙂 Se per {NOME_ATTIVITA} un sito non è una priorità adesso, nessun problema: le lascio il mio contatto e resto a disposizione. Ramona, AYROMEX",
  },
  {
    key: "archive_reject",
    label: "Chiusura gentile (lead non interessato)",
    variables: [],
    content:
      "Capito, nessun problema e grazie per la risposta! Se in futuro dovesse servirle una vetrina online, sa dove trovarmi. In bocca al lupo! Ramona, AYROMEX",
  },
  {
    key: "demo_ready",
    label: "Demo pronta (invio link al lead)",
    variables: ["{NOME_ATTIVITA}", "{URL_DEMO}"],
    content:
      "Eccoci! Come promesso, la demo del sito di {NOME_ATTIVITA} è pronta: {URL_DEMO}\nLa guardi con calma. Se le piace la mettiamo online con l'offerta di giugno. Ramona, AYROMEX",
  },
  // --- Cockpit/Visor (invio manuale): firma Ramona, tono Autopilot ---
  {
    key: "manual_step1",
    label: "Manuale · Step 1 primo contatto (Cockpit/Visor)",
    variables: ["{SALUTO}", "{COMPLIMENTO}"],
    content:
      "{SALUTO} Ho visto che su Google avete {COMPLIMENTO}, complimenti davvero. Con risultati così, manca solo un sito all'altezza: vi va di vederne una demo gratuita, senza impegno? Se vi piace, lo mettiamo online. Ramona, AYROMEX",
  },
  {
    key: "manual_step2",
    label: "Manuale · Step 2 conferma preview (Cockpit/Visor)",
    variables: ["{CATEGORIA}"],
    content:
      "Perfetto! La demo la prepariamo con materiale già pubblico del vostro {CATEGORIA}: foto, recensioni Google, contatti. Vi scrivo appena è pronta, entro 24 o 48 ore. Se vi piace ne parliamo, se no nessun problema. Ramona, AYROMEX",
  },
  {
    key: "manual_step3",
    label: "Manuale · Step 3 consegna demo + prezzo (Cockpit/Visor)",
    variables: ["{SALUTO}", "{URL_DEMO}", "{RIGA_PREZZO}"],
    content:
      "{SALUTO} Come promesso, la demo del vostro sito è pronta: {URL_DEMO}\nL'abbiamo pensata per trasformare chi vi cerca su Google in contatti e prenotazioni. Se vi piace, la versione completa va online in 2 giorni con dominio, hosting, setup e SEO inclusi.{RIGA_PREZZO}\nCosa ne pensate? Ramona, AYROMEX",
  },
  // --- Notifiche WA verso Puccio (worker) ---
  {
    key: "escalation_notify",
    label: "Notifica Puccio · escalation",
    variables: ["{NOME_ATTIVITA}", "{TELEFONO}", "{MOTIVO}", "{RIASSUNTO}"],
    content:
      "🔥 ESCALATION — {NOME_ATTIVITA} ({TELEFONO})\nMotivo: {MOTIVO}\n\n{RIASSUNTO}",
  },
  {
    key: "demo_request_notify",
    label: "Notifica Puccio · demo richiesta dal lead",
    variables: ["{NOME_ATTIVITA}", "{CITTA}"],
    content:
      "✅ DEMO RICHIESTA — {NOME_ATTIVITA} ({CITTA}). Prepara la demo e incolla il link in dashboard.",
  },
  {
    key: "kill_switch_notify",
    label: "Notifica Puccio · kill switch automatico",
    variables: ["{MOTIVO}"],
    content: "⚠️ AUTOPILOT FERMATO automaticamente: {MOTIVO}",
  },
];

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(
  join(here, "..", "lib", "templates", "schema.sql"),
  "utf8",
);

const client = createClient({ url, authToken });

console.log("Applying Template Manager schema…");
await client.executeMultiple(schema);

let inserted = 0;
for (const t of SEED) {
  const res = await client.execute({
    sql: `INSERT INTO message_templates (key, label, content, variables)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO NOTHING`,
    args: [t.key, t.label, t.content, JSON.stringify(t.variables)],
  });
  inserted += res.rowsAffected;
}

const res = await client.execute("SELECT COUNT(*) AS n FROM message_templates");
console.log(`  seeded: ${inserted} nuovi · totale: ${res.rows[0].n} template`);
console.log("Template Manager schema OK.");
