// Importa leads-ristoranti-bari.csv nella tabella `leads` di Turso.
// Id stabili rist-bari-NN → INSERT OR REPLACE = idempotente (rilanciabile).
// Uso: node scripts/import-ristoranti-bari.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

// --- env da .env.local ---
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const pick = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] ?? "").trim();
const url = pick("TURSO_DATABASE_URL");
const authToken = pick("TURSO_AUTH_TOKEN");
if (!url || !authToken) throw new Error("Credenziali Turso mancanti in .env.local");

const db = createClient({ url, authToken });

// --- parse CSV (campi quotati, virgolette raddoppiate) ---
function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csv = readFileSync(new URL("../leads-ristoranti-bari.csv", import.meta.url), "utf8");
const [header, ...dataRows] = parseCsv(csv);
const col = Object.fromEntries(header.map((h, i) => [h, i]));

const nowIso = new Date().toISOString();
let inserted = 0;

for (const r of dataRows) {
  const rank = String(r[col.rank]).padStart(2, "0");
  const id = `rist-bari-${rank}`;
  const name = r[col.name];
  const rating = r[col.rating];
  const reviews = Number(r[col.reviews]);
  const phone = r[col.phone] ? `+39 ${r[col.phone]}` : "";
  const address = r[col.address];
  const value = Number(r[col.est_value_eur]) || 1500;
  const maps = r[col.maps_url];

  const notes =
    `${rating}★ · ${reviews.toLocaleString("it-IT")} recensioni · NESSUN sito web. ` +
    `Angolo vendita: traffico regalato a TheFork/Google.`;

  // meta strutturato → alimenta il pitch engine (messaggi, next-action, contatti).
  const meta = JSON.stringify({
    rating: Number(rating),
    reviews,
    address,
    category: "ristorante",
    maps_url: maps,
  });

  // Lead "vivo" ma da contattare: alta priorità, inizio funnel.
  const probability = 30;
  const tags = JSON.stringify(["restaurant", "bari", "no-website", "ayromex-web", "hunter"]);

  await db.execute({
    sql: `INSERT OR REPLACE INTO leads
      (id, name, company, email, phone, source, status, value, probability,
       last_contact, next_action, notes, tags, created_at, updated_at, graph_connections, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      name,
      name, // company = nome ristorante (no contatto persona noto)
      "",
      phone,
      "maps",
      "todo",
      value,
      probability,
      nowIso,
      "Primo contatto WhatsApp — pitch: 4.5★ senza sito, traffico perso",
      notes,
      tags,
      nowIso,
      nowIso,
      "[]",
      meta,
    ],
  });
  inserted++;
}

// verifica conteggio in DB
const total = await db.execute("SELECT COUNT(*) AS n FROM leads");
const hunted = await db.execute(
  "SELECT COUNT(*) AS n FROM leads WHERE id LIKE 'rist-bari-%'",
);

console.log(`\n========================================`);
console.log(`Lead importati/aggiornati: ${inserted}`);
console.log(`Lead rist-bari-* in DB:    ${hunted.rows[0].n}`);
console.log(`Totale leads in DB:        ${total.rows[0].n}`);
console.log(`========================================`);
