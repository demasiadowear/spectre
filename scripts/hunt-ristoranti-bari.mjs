// Caccia mirata: ristoranti 4.5★+ SENZA sito web, Bari + hinterland.
// Places API (New) Text Search, paginazione 3 pagine, dedup, scoring.
// Uso: node scripts/hunt-ristoranti-bari.mjs
import { readFileSync, writeFileSync } from "node:fs";

// --- carica la key da .env.local (lo script gira fuori da Next) ---
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const KEY = (env.match(/^GOOGLE_PLACES_API_KEY=(.+)$/m)?.[1] ?? "").trim();
if (!KEY) throw new Error("GOOGLE_PLACES_API_KEY mancante in .env.local");

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

const CATEGORIES = ["ristoranti", "trattorie", "pizzerie", "osterie"];
const CITIES = [
  "Bari",
  "Bari Vecchia",
  "Bari Poggiofranco",
  "Modugno",
  "Bitritto",
  "Triggiano",
  "Capurso",
  "Valenzano",
  "Carbonara di Bari",
  "Ceglie del Campo",
  "Palese",
  "Santo Spirito Bari",
  "Mola di Bari",
  "Noicattaro",
];

const MIN_RATING = 4.5;
const MIN_REVIEWS = 20; // attività viva, non fantasma
const TARGET = 50;
const MAX_PAGES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchPage(textQuery, pageToken) {
  const body = { textQuery, languageCode: "it", maxResultCount: 20, minRating: MIN_RATING };
  if (pageToken) body.pageToken = pageToken;
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 400)}`);
  }
  return res.json();
}

async function searchAll(textQuery) {
  const out = [];
  let token;
  for (let p = 0; p < MAX_PAGES; p++) {
    const json = await searchPage(textQuery, token);
    out.push(...(json.places ?? []));
    token = json.nextPageToken;
    if (!token) break;
    await sleep(2200); // il pageToken richiede ~2s per attivarsi
  }
  return out;
}

function scoreLead(l) {
  let s = 0;
  if (!l.website) s += 45;
  if (l.rating >= 4.8) s += 25;
  else if (l.rating >= 4.5) s += 20;
  if (l.reviews >= 100) s += 20;
  else if (l.reviews >= 50) s += 15;
  else if (l.reviews >= 20) s += 10;
  if (l.phone) s += 15;
  s += 15; // categoria ristorazione = HOT
  s += 5; // città Bari area
  s = Math.max(0, Math.min(100, s));
  const priority = s >= 80 ? "HOT" : s >= 60 ? "WARM" : "COLD";
  const value = s >= 85 ? 1500 : s >= 70 ? 1200 : s >= 50 ? 1000 : 750;
  return { ...l, score: s, priority, value };
}

const seen = new Map();
let queries = 0;

for (const city of CITIES) {
  for (const cat of CATEGORIES) {
    if (seen.size >= TARGET * 2) break; // pool abbondante, poi filtriamo
    queries++;
    const q = `${cat} a ${city}`;
    try {
      const places = await searchAll(q);
      for (const p of places) {
        const id = p.id;
        if (!id || seen.has(id)) continue;
        const website = (p.websiteUri ?? "").trim();
        const rating = typeof p.rating === "number" ? p.rating : 0;
        const reviews = typeof p.userRatingCount === "number" ? p.userRatingCount : 0;
        // filtro: SENZA sito, 4.5★+, attività viva
        if (website) continue;
        if (rating < MIN_RATING) continue;
        if (reviews < MIN_REVIEWS) continue;
        seen.set(id, {
          id,
          name: p.displayName?.text ?? "—",
          address: p.formattedAddress ?? "",
          phone: p.nationalPhoneNumber ?? "",
          rating,
          reviews,
          website: null,
          maps: p.googleMapsUri ?? "",
        });
      }
      console.log(`  [${q}] → pool no-website: ${seen.size}`);
    } catch (e) {
      console.error(`  [${q}] ERRORE: ${e.message}`);
    }
    await sleep(300);
  }
}

const scored = [...seen.values()]
  .map(scoreLead)
  .sort((a, b) => b.score - a.score || b.reviews - a.reviews)
  .slice(0, TARGET);

// --- output CSV ---
const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
const header = "rank,name,rating,reviews,phone,address,score,priority,est_value_eur,maps_url";
const rows = scored.map((l, i) =>
  [i + 1, l.name, l.rating, l.reviews, l.phone, l.address, l.score, l.priority, l.value, l.maps]
    .map(esc)
    .join(","),
);
const csv = [header, ...rows].join("\n");
writeFileSync(new URL("../leads-ristoranti-bari.csv", import.meta.url), csv, "utf8");

const hot = scored.filter((l) => l.priority === "HOT").length;
const phones = scored.filter((l) => l.phone).length;
console.log(`\n========================================`);
console.log(`Query eseguite:      ${queries}`);
console.log(`Pool no-website:     ${seen.size}`);
console.log(`Lead consegnati:     ${scored.length}/${TARGET}`);
console.log(`  di cui HOT:        ${hot}`);
console.log(`  con telefono:      ${phones}`);
console.log(`Valore pipeline:     €${scored.reduce((a, l) => a + l.value, 0).toLocaleString("it-IT")}`);
console.log(`CSV salvato:         leads-ristoranti-bari.csv`);
console.log(`========================================`);
