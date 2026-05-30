// Backfill lat/lng on leads that have an address but no coords, via the
// free Nominatim (OpenStreetMap) geocoder. Rate-limited to 1 req/sec per
// their usage policy. Uso: node scripts/geocode-leads.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const pick = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] ?? "").trim();
const db = createClient({
  url: pick("TURSO_DATABASE_URL"),
  authToken: pick("TURSO_AUTH_TOKEN"),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(address) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(address);
  const res = await fetch(url, {
    headers: { "User-Agent": "AYROMEX-SPECTRE/1.0 (tools@ayromex.com)" },
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!Array.isArray(json) || json.length === 0) return null;
  return { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) };
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
  const address = meta.address || row.name;
  if (!address) {
    failed++;
    continue;
  }
  // Fallback: "street, city, Italia" (drop civic number + CAP + province).
  const cityM = address.match(/\d{5}\s+([A-Za-zÀ-ù'\s]+?)\s+[A-Z]{2}\b/);
  const street = address.split(",")[0];
  const simplified = cityM ? `${street}, ${cityM[1].trim()}, Italia` : null;
  try {
    let coords = await geocode(address);
    if (!coords && simplified) {
      await sleep(1100);
      coords = await geocode(simplified);
    }
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
      console.log(`  ✗ ${row.name} (no match)`);
    }
  } catch (e) {
    failed++;
    console.log(`  ✗ ${row.name} (${e.message})`);
  }
  await sleep(1100); // Nominatim: max ~1 req/sec
}

console.log(`\nGeocodati: ${done} · già ok: ${skipped} · falliti: ${failed}`);
