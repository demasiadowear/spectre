// Il file autonomo si apre con un doppio clic: si verifica cosi, da
// file://, senza server e senza rete. Se una fotografia manca qui,
// manca anche a chi lo ricevera per posta.
import { chromium } from "playwright-core";
import { resolve } from "node:path";
const f = "file://" + resolve(process.argv[2]);
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const pg = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "it-IT" });
const rete = [];
pg.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) rete.push(r.url()); });
const err = [];
pg.on("pageerror", (e) => err.push(String(e).slice(0, 200)));
await pg.goto(f, { waitUntil: "load" });
await pg.waitForTimeout(2500);
// Si aspetta stando in fondo: tornando in cima prima dell'attesa, le
// immagini rinviate escono di vista e non finiscono di caricarsi.
await pg.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); } });
await pg.waitForTimeout(1500);
await pg.evaluate(() => scrollTo(0, 0));
await pg.waitForTimeout(600);
const img = await pg.evaluate(() => [...document.querySelectorAll("img")].map(i => i.complete && i.naturalWidth > 0));
const font = await pg.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
await pg.screenshot({ path: process.argv[3], fullPage: false });
console.log(`immagini: ${img.filter(Boolean).length}/${img.length} dipinte`);
console.log(`richieste di rete: ${rete.length}${rete.length ? " -> " + rete.slice(0, 5).join(", ") : " (nessuna)"}`);
console.log(`errori: ${err.length ? err.join(" | ") : "nessuno"}`);
console.log(`font h1: ${font}`);
await br.close();
if (img.some(x => !x) || rete.length || err.length) process.exitCode = 1;
