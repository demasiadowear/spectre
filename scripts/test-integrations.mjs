// Live smoke test for the Gemini + Google Places integrations.
// Reads keys from env (never printed). Run after exporting:
//   GEMINI_API_KEY, GOOGLE_PLACES_API_KEY
import { GoogleGenerativeAI } from "@google/generative-ai";

const PLACES = process.env.GOOGLE_PLACES_API_KEY;
const GEMINI = process.env.GEMINI_API_KEY;

async function testPlaces() {
  console.log("\n=== GOOGLE PLACES (New) — 'parrucchiere a Bari' ===");
  if (!PLACES) {
    console.log("  (no GOOGLE_PLACES_API_KEY — skipped)");
    return;
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount",
    },
    body: JSON.stringify({
      textQuery: "parrucchiere a Bari",
      languageCode: "it",
      maxResultCount: 5,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.log("  REQUEST FAILED:", res.status, t.slice(0, 300));
    return;
  }
  const json = await res.json();
  const places = json.places ?? [];
  console.log(`  results: ${places.length}`);
  for (const p of places) {
    const site = p.websiteUri ? "✓ sito" : "✗ NO SITO";
    const tel = p.nationalPhoneNumber ? "✓ tel" : "✗ no tel";
    const rev = p.userRatingCount ?? 0;
    console.log(
      `   • ${p.displayName?.text ?? "?"} — ${site} · ${tel} · ⭐${p.rating ?? "-"} (${rev})`,
    );
  }
}

async function placesPage(body) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount,nextPageToken",
    },
    body: JSON.stringify(body),
  });
  return res.ok ? await res.json() : null;
}

async function testPlacesPagination() {
  console.log("\n=== PAGINAZIONE — 'ristoranti a Bari' (max 3 pagine) ===");
  if (!PLACES) {
    console.log("  (no GOOGLE_PLACES_API_KEY — skipped)");
    return;
  }
  const base = { textQuery: "ristoranti a Bari", languageCode: "it", pageSize: 20 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const all = [];
  const seen = new Set();
  let token;
  for (let page = 0; page < 3; page++) {
    const body = token ? { ...base, pageToken: token } : base;
    let j = await placesPage(body);
    if (token && !(j && j.places && j.places.length)) {
      await sleep(1500);
      j = await placesPage(body);
    }
    if (!j) {
      console.log(`  pagina ${page + 1}: errore/empty`);
      break;
    }
    const got = j.places ?? [];
    for (const p of got) {
      if (p.id && !seen.has(p.id)) {
        seen.add(p.id);
        all.push(p);
      }
    }
    console.log(
      `  pagina ${page + 1}: +${got.length} (totale ${all.length})${j.nextPageToken ? " [next]" : " [fine]"}`,
    );
    token = j.nextPageToken;
    if (!token) break;
  }
  const noSite = all.filter((p) => !p.websiteUri).length;
  console.log(`  >>> TOTALE: ${all.length} ristoranti | SENZA SITO: ${noSite}`);
}

async function testGemini() {
  console.log("\n=== GEMINI — ping gemini-2.5-flash-lite ===");
  if (!GEMINI) {
    console.log("  (no GEMINI_API_KEY — skipped)");
    return;
  }
  const genai = new GoogleGenerativeAI(GEMINI);
  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: "Rispondi SOLO con JSON valido.",
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });
  const res = await model.generateContent(
    'Restituisci esattamente {"ok":true,"engine":"gemini"}',
  );
  const text = res.response.text().trim();
  const parsed = JSON.parse(text);
  console.log("  response:", JSON.stringify(parsed));
}

try {
  await testPlaces();
  await testPlacesPagination();
  await testGemini();
  console.log("\nDone.");
} catch (e) {
  console.error("TEST ERROR:", e.message);
  process.exit(1);
}
