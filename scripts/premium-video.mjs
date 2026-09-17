// ============================================================
// Registrazione delle animazioni del sito premium.
//
// Cattura video reale con Chromium: apertura (le righe del titolo che
// salgono), poi uno scroll lento fino in fondo per mostrare la spina
// che si disegna, poi il ritorno su.
//
// Uso: node scripts/premium-video.mjs <dist> <out-dir> [larghezza] [altezza]
// ============================================================

import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, statSync, renameSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DIST = resolve(process.argv[2] ?? "dist");
const OUT = resolve(process.argv[3] ?? "video");
const W = Number(process.argv[4] ?? 1440);
const H = Number(process.argv[5] ?? 900);
const PORT = 4340;
mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png",
};

const server = createServer((req, res) => {
  let f = join(DIST, decodeURIComponent((req.url ?? "/").split("?")[0]));
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
  if (!existsSync(f)) { res.writeHead(404); return res.end("404"); }
  const b = readFileSync(f);
  res.writeHead(200, { "Content-Type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(b);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch({
  executablePath: process.env.FACTORY_CHROME_PATH ?? "/opt/pw-browsers/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  locale: "it-IT",
  reducedMotion: "no-preference",
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
const page = await ctx.newPage();

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });

// 1. L'apertura: le righe del titolo salgono. Si lascia finire.
await page.waitForTimeout(2600);

// 2. Scroll lento fino in fondo: la spina si disegna col rotolo.
//    Passi piccoli e frequenti, perché è così che si scorre davvero e
//    perché uno scrollTo secco non mostrerebbe il disegno della linea.
const altezza = await page.evaluate(() => document.body.scrollHeight);
const passi = 150;
for (let i = 1; i <= passi; i++) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), (altezza - H) * (i / passi));
  await page.waitForTimeout(28);
}
await page.waitForTimeout(1200);

// 3. Ritorno su, più rapido.
for (let i = passi; i >= 0; i--) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), (altezza - H) * (i / passi));
  await page.waitForTimeout(12);
}
await page.waitForTimeout(900);

const video = page.video();
await ctx.close();
await browser.close();
server.close();

if (video) {
  const path = await video.path();
  const dest = join(OUT, `animazioni-${W}x${H}.webm`);
  renameSync(path, dest);
  console.log(`video: ${dest} (${Math.round(statSync(dest).size / 1024)} KB)`);
} else {
  console.log("nessun video prodotto");
  process.exitCode = 1;
}
console.log("file nella cartella:", readdirSync(OUT).join(", "));
