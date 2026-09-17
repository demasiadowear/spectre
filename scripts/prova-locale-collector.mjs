// ============================================================
// Prepara un'istanza LOCALE completa di Specter per provare il
// collector senza toccare la produzione.
//
// Crea un database libSQL su file con lo schema reale, ci mette un
// lead, e produce un dossier facendo girare il collector vero con le
// fonti sostituite da fixture. Serve a vedere la dashboard popolata e a
// verificare il giro completo quando le chiavi non sono disponibili.
//
// NON e un sostituto della prova su dati reali: le fonti sono fixture e
// il dossier lo dichiara (place_id e host sono `.example`).
//
// Uso: node scripts/prova-locale-collector.mjs <percorso.db>
// ============================================================
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const percorso = resolve(process.argv[2] ?? "/tmp/spectre-locale.db");
process.env.TURSO_DATABASE_URL = `file:${percorso}`;
process.env.TURSO_AUTH_TOKEN = "locale-non-usato";

const db = createClient({ url: process.env.TURSO_DATABASE_URL });
for (const f of ["lib/turso/schema.sql", "lib/factory/schema.sql"]) {
  try { await db.executeMultiple(readFileSync(f, "utf8")); } catch { /* gia applicato */ }
}

const { ensureCollectorSchema, salvaDossier } = await import("../lib/collector/db.ts");
const { raccogli } = await import("../lib/collector/collect.ts");
const { DirectHtmlProvider } = await import("../lib/collector/browser.ts");
await ensureCollectorSchema();

const LEAD = "lead-prova-locale";
await db.execute({
  sql: `insert or replace into leads (id, name, company, phone, email, status, meta)
        values (?, ?, ?, ?, ?, 'todo', ?)`,
  args: [LEAD, "Trattoria di Prova", "Trattoria di Prova", "080 555 0101",
    "", JSON.stringify({ city: "Bari", category: "ristorante", place_id: "PLACE-PROVA-1" })],
});

const SCHEDA = {
  place_id: "PLACE-PROVA-1", name: "Trattoria di Prova",
  address: "Via Sparano 10, 70121 Bari BA", lat: 41.1216, lng: 16.8695,
  phone: "080 555 0101", phone_international: "+39 080 555 0101",
  website: "https://trattoriadiprova.example/",
  maps_url: "https://maps.google.com/?cid=42",
  category: "Ristorante", types: ["restaurant"], rating: 4.4, reviews: 218,
  business_status: "OPERATIONAL",
  hours: ["lunedì: chiuso", "martedì: 12:30–15:00, 19:30–23:00", "mercoledì: 12:30–15:00, 19:30–23:00"],
  photos: [
    { name: "places/PLACE-PROVA-1/photos/AAA", widthPx: 3000, heightPx: 2000, attributions: ["Mario Rossi"] },
    { name: "places/PLACE-PROVA-1/photos/BBB", widthPx: 2400, heightPx: 1600, attributions: ["Lucia Bianchi"] },
  ],
  summary: "",
};

const HTML = `<!doctype html><html lang="it"><head>
<title>Trattoria di Prova — Bari</title>
<meta name="description" content="Cucina pugliese di stagione, sala interna e giardino estivo.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant",
"name":"Trattoria di Prova","telephone":"+39 080 999 8888",
"address":{"@type":"PostalAddress","streetAddress":"Via Sparano 10","addressLocality":"Bari"},
"email":"info@trattoriadiprova.example",
"openingHours":["Tu-Sa 12:30-15:00","Tu-Sa 19:30-23:30"],
"sameAs":["https://www.instagram.com/trattoriadiprova","https://www.facebook.com/trattoriadiprova"]}</script>
</head><body>
<h1>Trattoria di Prova</h1>
<p>${"Cucina pugliese di stagione, pasta fatta a mano ogni mattina, forno a legna. ".repeat(10)}</p>
<ul><li>Orecchiette alle cime di rapa</li><li>Pasta al forno</li><li>Menu di pesce</li></ul>
<a href="https://www.instagram.com/trattoriadiprova">Instagram</a>
<a href="https://www.facebook.com/trattoriadiprova">Facebook</a>
<a href="/chi-siamo">Chi siamo</a>
<img src="/foto/sala-interna.jpg" alt="la sala del locale" width="1800" height="1200">
<img src="/foto/piatto-orecchiette.jpg" alt="orecchiette alle cime di rapa" width="1600" height="1200">
<img src="/foto/esterno-insegna.jpg" alt="l'insegna e la facciata" width="1500" height="1000">
<img src="/foto/logo.png" alt="logo" width="320" height="120">
<img src="https://cdn-a-caso.example/bella-foto.jpg" alt="una foto trovata altrove" width="1600" height="1100">
</body></html>`;

class ProviderFixture {
  nome = "ProviderFixture";
  esegueJavaScript = false;
  #diretto = new DirectHtmlProvider();
  async apri(url) {
    if (url.includes("trattoriadiprova.example")) {
      return { url, final_url: url, esito: "ok", status: 200, html: HTML, detail: "", ssrf: "", ms: 4 };
    }
    return this.#diretto.apri(url);
  }
}

const places = {
  async dettaglio() { return { ok: true, scheda: SCHEDA, candidati: [], error: "", calls: 1, ms: 6 }; },
  async cerca() { return { ok: true, scheda: null, candidati: [SCHEDA], error: "", calls: 1, ms: 6 }; },
};

const { dossier, phases } = await raccogli({
  lead_id: LEAD, name: "Trattoria di Prova", city: "Bari",
  address: "Via Sparano 10", phone: "080 555 0101", email: "", website: "",
  place_id: "PLACE-PROVA-1", manual: {}, linked_pages: [], media_forniti: [],
}, { places, provider: new ProviderFixture() });

await salvaDossier({ dossier, phases, job_id: "job-prova-locale" });

console.log(`  database: ${percorso}`);
console.log(`  fasi: ${phases.map((p) => `${p.phase}=${p.status}`).join(" ")}`);
console.log(`  raccomandazione: ${dossier.recommendation}`);
console.log(`  fatti: ${dossier.verified.length} verificati, ${dossier.probable.length} probabili`);
console.log(`  conflitti: ${dossier.conflicts.map((c) => c.field).join(", ") || "nessuno"}`);
console.log(`  mancanti: ${dossier.missing.join(", ") || "nessuno"}`);
console.log(`  profili: ${dossier.identities.map((i) => `${i.platform}=${i.status}`).join(" ")}`);
console.log(`  media: ${dossier.media.candidates.length} candidate, ${dossier.media.rejected.length} scartate`);
for (const [k, v] of Object.entries(dossier.media.by_rights)) if (v) console.log(`    ${k}: ${v}`);
