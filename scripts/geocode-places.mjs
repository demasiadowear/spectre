// Geocode leads still missing lat/lng using the Google Places API (New)
// Text Search — they ARE real Google Maps businesses, so name+city resolves.
// Uso: node scripts/geocode-places.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const pick = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] ?? "").trim();
const KEY = pick("GOOGLE_PLACES_API_KEY");
if (!KEY) throw new Error("GOOGLE_PLACES_API_KEY mancante");
const db = createClient({
  url: pick("TURSO_DATABASE_URL"),
  authToken: pick("TURSO_AUTH_TOKEN"),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function placeCoords(query) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "places.location",
    },
    body: JSON.stringify({ textQuery: query, languageCode: "it", maxResultCount: 1 }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const loc = json.places?.[0]?.location;
  if (!loc || typeof loc.latitude !== "number") return null;
  return { lat: loc.latitude, lng: loc.longitude };
}

function cityOf(address) {
  const m = address.match(/\d{5}\s+([A-Za-zÀ-ù'\s]+?)\s+[A-Z]{2}\b/);
  return m ? m[1].trim() : "";
}

const rows = (await db.execute("SELECT id, name, meta FROM leads")).rows;
let done = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  let meta = {};
  try {
    meta = JSON.parse(String(row.meta || "{}"));
  } catch {
    meta = {};
  }
  if (typeof meta.lat === "number" && typeof meta.lng === "number") {
    skipped++;
    continue;
  }
  const city = cityOf(meta.address || "");
  const query = `${row.name}${city ? ", " + city : ""}`;
  try {
    const coords = await placeCoords(query);
    if (coords) {
      meta.lat = coords.lat;
      meta.lng = coords.lng;
      await db.execute({
        sql: "UPDATE leads SET meta = ? WHERE id = ?",
        args: [JSON.stringify(meta), row.id],
      });
      done++;
      console.log(`  ✓ ${row.name} → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
    } else {
      failed++;
      console.log(`  ✗ ${row.name}`);
    }
  } catch (e) {
    failed++;
    console.log(`  ✗ ${row.name} (${e.message})`);
  }
  await sleep(200);
}

const tot = (await db.execute(
  "SELECT COUNT(*) n FROM leads WHERE json_extract(meta,'$.lat') IS NOT NULL",
)).rows[0].n;
console.log(`\nGeocodati ora: ${done} · già ok: ${skipped} · falliti: ${failed}`);
console.log(`Totale con coordinate: ${tot}/${rows.length}`);
