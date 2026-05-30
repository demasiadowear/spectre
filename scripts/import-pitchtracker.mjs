// Import pitch-tracker beauty leads into SPECTRE (segment "beauty").
// 1) backup current leads → file  2) tag existing 50 as "ristoranti"
// 3) import 28 salons (+ tracker states/notes for the 16 worked)
// 4) Giosuè custom lead  5) dedup-by-phone WARN only.
// Idempotent (INSERT OR REPLACE, stable ids). NON unisce alla cieca.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const pick = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] ?? "").trim();
const db = createClient({
  url: pick("TURSO_DATABASE_URL"),
  authToken: pick("TURSO_AUTH_TOKEN"),
});

const NOW = "2026-05-30T19:00:00.000Z";
const TPL = {
  MINIMAL: "https://ayromex-template-minimal.vercel.app",
  CLASSICO: "https://ayromex-template-classico.vercel.app",
  EDITORIALE: "https://ayromex-template-editoriale.vercel.app",
  POP: "https://ayromex-template-pop.vercel.app",
  MONO: "https://ayromex-template-mono.vercel.app",
};

// 28 saloni (RAW_LEADS_ORIG dall'HTML).
const RAW = [
  { idx: 0, tier: "T1", tmpl: "EDITORIALE", listino: 1800, prezzo: 1080, name: "Quintessenza Beauty Lab", zone: "Bari", rating: 5.0, reviews: 233, phone: "0805668048", ig: "", fb: "", address: "Via Effrem Datto, 14, Bari" },
  { idx: 1, tier: "T1", tmpl: "MINIMAL", listino: 1200, prezzo: 720, name: "Studio-S Estetica di Sara Antonucci", zone: "Lecce", rating: 5.0, reviews: 88, phone: "3409607827", ig: "", fb: "", address: "Via Nino Bixio, 11 B, Lecce" },
  { idx: 2, tier: "T1", tmpl: "MINIMAL", listino: 1200, prezzo: 720, name: "BEAUTY LAB by Julie", zone: "Bari", rating: 5.0, reviews: 72, phone: "3314065112", ig: "beauty_labbari", fb: "", address: "Via Papa Bonifacio IX, 45, Bari" },
  { idx: 3, tier: "T1", tmpl: "MINIMAL", listino: 1200, prezzo: 720, name: "Gold Cosmetic Culture", zone: "Lecce", rating: 5.0, reviews: 51, phone: "3471852028", ig: "", fb: "goldcosmeticculture", address: "Via Silvio Pellico, 29, Lecce" },
  { idx: 4, tier: "T1", tmpl: "CLASSICO", listino: 1200, prezzo: 720, name: "Irene Parrucchieri Bari", zone: "Bari", rating: 5.0, reviews: 40, phone: "3208081415", ig: "", fb: "", address: "Viale Orazio Flacco, 9b, Bari" },
  { idx: 5, tier: "T1", tmpl: "MONO", listino: 1500, prezzo: 900, name: "Parrucchiere Fiorentino Uomo Donna", zone: "Lecce", rating: 4.9, reviews: 743, phone: "3298050876", ig: "", fb: "Fiorentinoparrucchieri", address: "Via Taranto, 38f, Lecce" },
  { idx: 6, tier: "T1", tmpl: "EDITORIALE", listino: 1800, prezzo: 1080, name: "Whitney Concept of Beauty", zone: "Bari", rating: 4.9, reviews: 261, phone: "3892167975", ig: "whitneyconceptofbeauty", fb: "", address: "Largo Nitti Valentini, 12, Bari" },
  { idx: 7, tier: "T1", tmpl: "EDITORIALE", listino: 1800, prezzo: 1080, name: "ROBERTO MARGIOTTA", zone: "Lecce", rating: 4.9, reviews: 114, phone: "0832314894", ig: "", fb: "", address: "Via G. Oberdan, 111, Lecce" },
  { idx: 8, tier: "T1", tmpl: "EDITORIALE", listino: 1800, prezzo: 1080, name: "Centro Estetico BellEssere Lecce", zone: "Lecce", rating: 4.9, reviews: 112, phone: "3281428900", ig: "", fb: "profile.php?id=61559374124586", address: "Via di Leuca, 212, Lecce" },
  { idx: 9, tier: "T1", tmpl: "EDITORIALE", listino: 1800, prezzo: 1080, name: "Tagliati X Il Successo (Gianni Sasso)", zone: "Lecce", rating: 4.9, reviews: 91, phone: "0832390469", ig: "", fb: "", address: "Via Cosimo de Giorgi, 43, Lecce" },
  { idx: 10, tier: "T2", tmpl: "CLASSICO", listino: 1200, prezzo: 900, name: "Tony Campilongo Hair Specialist", zone: "Lecce", rating: 4.9, reviews: 72, phone: "3403079734", ig: "", fb: "Testeinfesta", address: "Via Francesco de Mura, 36, Lecce" },
  { idx: 11, tier: "T2", tmpl: "CLASSICO", listino: 1200, prezzo: 900, name: "Claudia Gemini Parrucchiere", zone: "Lecce", rating: 4.9, reviews: 63, phone: "3208952949", ig: "", fb: "", address: "Via B. Croce, 50, Lecce" },
  { idx: 12, tier: "T2", tmpl: "CLASSICO", listino: 1200, prezzo: 900, name: "Candini Elisabetta", zone: "Lecce", rating: 4.9, reviews: 63, phone: "0832452758", ig: "", fb: "", address: "Viale Giovanni Paolo II, 40, Lecce" },
  { idx: 13, tier: "T2", tmpl: "MINIMAL", listino: 1200, prezzo: 900, name: "Elisabetta Montaruli Beauty Center", zone: "Bari", rating: 4.9, reviews: 55, phone: "0802059687", ig: "", fb: "", address: "Via Nicolò Putignani, 50, Bari" },
  { idx: 14, tier: "T2", tmpl: "MINIMAL", listino: 1200, prezzo: 900, name: "Ad Maiora Body & Soul", zone: "Bari", rating: 4.9, reviews: 47, phone: "3273575997", ig: "", fb: "", address: "Viale Vito Vittorio Lenoci, 6/B, Bari" },
  { idx: 15, tier: "T2", tmpl: "EDITORIALE", listino: 1800, prezzo: 1350, name: "Luxury Spa", zone: "Bari", rating: 4.8, reviews: 138, phone: "0804721930", ig: "", fb: "", address: "Via Nicolò Putignani, 128, Bari" },
  { idx: 16, tier: "T2", tmpl: "CLASSICO", listino: 1200, prezzo: 900, name: "Parrucchiere Chiara Hairdressing", zone: "Bari", rating: 4.8, reviews: 124, phone: "0805422200", ig: "", fb: "chiarahairdressing", address: "Viale Antonio Salandra, 19/G, Bari" },
  { idx: 17, tier: "T2", tmpl: "CLASSICO", listino: 1200, prezzo: 900, name: "Giò Parrucchieri Bari", zone: "Bari", rating: 4.8, reviews: 123, phone: "0808641533", ig: "", fb: "", address: "Via Giuseppe Palmieri, 45e, Bari" },
  { idx: 18, tier: "T2", tmpl: "CLASSICO", listino: 1200, prezzo: 900, name: "Anna & Luca Parrucchieri", zone: "Lecce", rating: 4.8, reviews: 115, phone: "0832302148", ig: "", fb: "", address: "Viale Francesco Lo Re, 20, Lecce" },
  { idx: 19, tier: "T2", tmpl: "MINIMAL", listino: 1200, prezzo: 900, name: "Dalí Professional Beauty", zone: "Bari", rating: 4.8, reviews: 87, phone: "0802374020", ig: "", fb: "", address: "Via Melo da Bari, 172, Bari" },
  { idx: 20, tier: "T3", tmpl: "MINIMAL", listino: 1200, prezzo: 1020, name: "Beauty Moon", zone: "Bari", rating: 4.8, reviews: 78, phone: "3282855132", ig: "", fb: "", address: "Via Mauro Amoruso Manzari, 86a, Bari" },
  { idx: 21, tier: "T3", tmpl: "MINIMAL", listino: 1200, prezzo: 1020, name: "Kalè Centro Estetico", zone: "Lecce", rating: 4.8, reviews: 66, phone: "3297888346", ig: "", fb: "", address: "Via S. Cesario, 112, Lecce" },
  { idx: 22, tier: "T3", tmpl: "CLASSICO", listino: 1200, prezzo: 1020, name: "Daniele Parrucchiere Unisex", zone: "Lecce", rating: 4.8, reviews: 64, phone: "0832349680", ig: "", fb: "", address: "Via Pordenone, 15, Lecce" },
  { idx: 23, tier: "T3", tmpl: "MINIMAL", listino: 1200, prezzo: 1020, name: "CHARME centro estetico", zone: "Lecce", rating: 4.8, reviews: 59, phone: "3270603869", ig: "", fb: "", address: "Via Salesiani, 7/9, Lecce" },
  { idx: 24, tier: "T3", tmpl: "MINIMAL", listino: 1200, prezzo: 1020, name: "Alizzi Centro Estetico", zone: "Lecce", rating: 4.7, reviews: 203, phone: "3516018974", ig: "", fb: "", address: "Via Luigi Corvaglia, 20, Lecce" },
  { idx: 25, tier: "T3", tmpl: "CLASSICO", listino: 1200, prezzo: 1020, name: "I Catanzaro Parrucchieri Mitù", zone: "Bari", rating: 4.7, reviews: 131, phone: "0807989342", ig: "", fb: "", address: "Via Melo da Bari, 68, Bari" },
  { idx: 26, tier: "T3", tmpl: "MINIMAL", listino: 1200, prezzo: 1020, name: "Sentieri di Benessere Beauty & Spa", zone: "Bari", rating: 4.5, reviews: 139, phone: "0803323668", ig: "", fb: "sentieridibenessere.bari", address: "Via Principe Amedeo, 239, Bari" },
  { idx: 27, tier: "T3", tmpl: "MINIMAL", listino: 1200, prezzo: 1020, name: "Estethia", zone: "Bari", rating: 4.5, reviews: 92, phone: "0805222296", ig: "", fb: "", address: "Via Sagarriga Visconti, 97, Bari" },
];

// State export dal pitch-tracker (chiave = idx). 28-41 = lead custom (no base data).
const STATE = {
  "1": { status: "step1_sent", step1Date: "2026-05-19T08:12:10.847Z" },
  "2": { status: "step1_sent", step1Date: "2026-05-16T07:47:30.324Z" },
  "3": { status: "step1_sent", step1Date: "2026-05-19T08:11:39.811Z" },
  "4": { status: "step1_sent", repliedDate: "2026-05-16T08:00:51.634Z", step1Date: "2026-05-16T08:20:36.125Z" },
  "5": { status: "step1_sent", repliedDate: "2026-05-16T08:00:50.220Z", step1Date: "2026-05-16T08:20:40.436Z" },
  "6": { status: "lost", repliedDate: "2026-05-16T08:00:42.956Z", note: "⚠️ WIX SCADUTO whitneycob.com (visibile su IG bio @whitneyconceptofbeauty). 4000+ follower IG cliccano e trovano errore. LEVA FORTE per Step 1 personalizzato.", step1Date: "2026-05-16T07:54:23.602Z", lostReason: "sta gia provvedendo , ricontattare eventualemente a fine maggio" },
  "8": { status: "step1_sent", step1Date: "2026-05-16T08:25:21.174Z" },
  "10": { status: "step1_sent", step1Date: "2026-05-18T14:14:00.000Z" },
  "11": { status: "lost", repliedDate: "2026-05-16T09:46:41.160Z", step1Date: "2026-05-16T08:26:12.332Z", step2Date: "2026-05-16T09:46:44.009Z", lostReason: "" },
  "13": { status: "todo", step1Date: "2026-05-16T07:55:36.377Z" },
  "14": { status: "step1_sent", repliedDate: "2026-05-16T08:00:46.147Z", step1Date: "2026-05-16T08:20:44.114Z" },
  "15": { status: "todo", step1Date: "2026-05-16T07:56:45.662Z" },
  "20": { status: "step1_sent", repliedDate: "2026-05-16T08:00:47.588Z", step1Date: "2026-05-16T08:20:46.734Z" },
  "21": { status: "step1_sent", step1Date: "2026-05-16T08:27:33.810Z" },
  "23": { status: "step1_sent", step1Date: "2026-05-18T14:13:00.406Z" },
  "24": { status: "lost", step1Date: "2026-05-19T08:10:47.664Z", lostReason: "NUMERO NON SU WA" },
};

const PROB = { todo: 30, step1_sent: 40, replied: 55, step2_sent: 60, preview_sent: 68, negotiating: 75, closed: 100, lost: 0 };
const onlyDigits = (p) => (p || "").replace(/\D/g, "").replace(/^39/, "");

function category(name) {
  const n = name.toLowerCase();
  if (/parrucchier|hair|coiffeur|tagliati|campilongo|fiorentino|margiotta|catanzaro/.test(n)) return "parrucchiere";
  return "estetista";
}

// ---- 0. BACKUP ----
const before = (await db.execute("SELECT * FROM leads")).rows;
const backupPath = new URL("../ayrobackup-leads-pre-pitchtracker.json", import.meta.url);
writeFileSync(backupPath, JSON.stringify(before, null, 2), "utf8");
console.log(`BACKUP: ${before.length} leads salvati in ayrobackup-leads-pre-pitchtracker.json`);

// ---- DEDUP: phones esistenti ----
const existingPhones = new Map();
for (const r of before) {
  const d = onlyDigits(String(r.phone || ""));
  if (d) existingPhones.set(d, String(r.name));
}

// ---- 1. SEGMENTO sui 50 esistenti = "ristoranti" ----
let tagged = 0;
for (const r of before) {
  let meta = {};
  try { meta = JSON.parse(String(r.meta || "{}")); } catch {}
  if (meta.segmento === "ristoranti") continue;
  meta.segmento = "ristoranti";
  await db.execute({ sql: "UPDATE leads SET meta = ? WHERE id = ?", args: [JSON.stringify(meta), r.id] });
  tagged++;
}
console.log(`SEGMENTO: ${tagged} lead esistenti taggati "ristoranti"`);

// ---- 2+3. 28 saloni + stati ----
let inserted = 0, withState = 0;
const dupWarnings = [];
for (const s of RAW) {
  const dup = existingPhones.get(onlyDigits(s.phone));
  if (dup) dupWarnings.push(`  ⚠️ ${s.name} (${s.phone}) telefono uguale a "${dup}" tra i ristoranti`);

  const st = STATE[String(s.idx)] || { status: "todo" };
  const meta = {
    segmento: "beauty",
    category: category(s.name),
    rating: s.rating,
    reviews: s.reviews,
    address: s.address,
    zone: s.zone,
    ig: s.ig || undefined,
    fb: s.fb || undefined,
    tier: s.tier,
    listino: s.listino,
    prezzo: s.prezzo,
    web_template: s.tmpl,
    template_url: TPL[s.tmpl],
    step1_at: st.step1Date,
    replied_at: st.repliedDate,
    step2_at: st.step2Date,
    lost_reason: st.lostReason || undefined,
  };
  // note + next_action
  let notes = "";
  if (st.note) notes = st.note;
  if (st.lostReason) notes = (notes ? notes + " · " : "") + `LOST: ${st.lostReason}`;
  let nextAction = "Primo contatto — angolo: numeri Google senza sito identitario";
  if (st.status === "lost" && /fine maggio|ricontatt/i.test(st.lostReason || "")) nextAction = "Ricontattare fine maggio";

  await db.execute({
    sql: `INSERT OR REPLACE INTO leads
      (id, name, company, email, phone, source, status, value, probability,
       last_contact, next_action, notes, tags, created_at, updated_at, graph_connections, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `beauty-${String(s.idx).padStart(2, "0")}`,
      s.name, s.name, "", s.phone, "beauty", st.status, s.prezzo,
      PROB[st.status] ?? 30,
      st.step1Date || NOW, nextAction, notes,
      JSON.stringify(["beauty", s.zone.toLowerCase(), s.tier, "pitch-tracker"]),
      NOW, NOW, "[]", JSON.stringify(meta),
    ],
  });
  inserted++;
  if (STATE[String(s.idx)]) withState++;
}
console.log(`SALONI: ${inserted} importati (${withState} con stato/note dal tracker)`);

// ---- 4. Giosuè (custom idx 41, recuperabile dalla nota) ----
const giosuePhone = "3288873214";
const giosueDup = existingPhones.get(onlyDigits(giosuePhone));
if (giosueDup) dupWarnings.push(`  ⚠️ Giosuè (${giosuePhone}) telefono uguale a "${giosueDup}"`);
await db.execute({
  sql: `INSERT OR REPLACE INTO leads
    (id, name, company, email, phone, source, status, value, probability,
     last_contact, next_action, notes, tags, created_at, updated_at, graph_connections, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [
    "beauty-cust-41", "Giosuè (titolare)", "Giosuè (titolare)", "", giosuePhone,
    "beauty", "todo", 1080, 30, NOW,
    "Callback 27/05 ore 18:00 — chiedere del titolare",
    "Numero titolare GIOSUE' 3288873214 (lead custom pitch-tracker)",
    JSON.stringify(["beauty", "pitch-tracker", "callback"]),
    NOW, NOW, "[]",
    JSON.stringify({ segmento: "beauty", category: "estetista", callback: "2026-05-27T18:00" }),
  ],
});
console.log("CUSTOM: Giosuè (idx 41) importato come beauty-cust-41");

// ---- Report custom non importabili ----
console.log("\nSTATI CUSTOM NON IMPORTABILI (identità mancante):");
console.log("  idx 40: nota 'CHIAMARE INTORNO ALLE 14 E CHIEDERE DEL TITOLARE' — nessun nome/telefono");
console.log("  idx 28,30,35,36,37,39: step1_sent (solo date, nessuna identità/nota)");

console.log("\n=== DEDUP (telefono beauty vs ristoranti) ===");
console.log(dupWarnings.length ? dupWarnings.join("\n") : "  Nessuna sovrapposizione di telefono.");

const tot = (await db.execute("SELECT COUNT(*) n FROM leads")).rows[0].n;
const beauty = (await db.execute("SELECT COUNT(*) n FROM leads WHERE source='beauty'")).rows[0].n;
console.log(`\n=== TOTALI ===`);
console.log(`  Lead totali: ${tot} · beauty: ${beauty} · ristoranti: ${tagged || before.length}`);
