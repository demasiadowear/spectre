// ============================================================
// Confronto affiancato dei siti della Factory.
//
// Serve al test anti-omologazione: quattro prime videate una accanto
// all'altra, piu quattro pagine intere in scala, in una sola immagine.
// Se sembrano lo stesso template, si vede qui e non in un punteggio.
//
// Uso: node scripts/premium-confronto.mjs <uscita.png> <etichetta:dist>...
// ============================================================
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { chromium } from "playwright-core";

const USCITA = resolve(process.argv[2] ?? "confronto.png");
const SITI = process.argv.slice(3).map((v) => {
  const i = v.indexOf(":");
  return { nome: v.slice(0, i), dist: resolve(v.slice(i + 1)) };
});
mkdirSync(dirname(USCITA), { recursive: true });

const MIME = { ".html": "text/html;charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const scatti = [];
let porta = 4410;
for (const s of SITI) {
  const srv = createServer((q, r) => {
    const p = decodeURIComponent((q.url ?? "/").split("?")[0]);
    let f = join(s.dist, p === "/" ? "/index.html" : p);
    if (!existsSync(f) || statSync(f).isDirectory()) f = join(s.dist, "index.html");
    const b = readFileSync(f);
    r.writeHead(200, { "Content-Type": MIME[extname(f)] ?? "application/octet-stream" });
    r.end(b);
  });
  const p = porta++;
  await new Promise((r) => srv.listen(p, "127.0.0.1", r));

  const pg = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await pg.goto(`http://127.0.0.1:${p}/index.html`, { waitUntil: "networkidle" });
  await pg.waitForTimeout(2600);
  // La pastiglia "Concept demo" sta fuori dalla composizione: nel
  // confronto fra direzioni artistiche e rumore, ed e uguale su tutti.
  await pg.addStyleTag({ content: ".nota-concept{display:none !important}" });
  const videata = (await pg.screenshot()).toString("base64");
  const intera = (await pg.screenshot({ fullPage: true })).toString("base64");
  const altezza = await pg.evaluate(() => document.body.scrollHeight);
  await pg.close();
  srv.close();
  scatti.push({ nome: s.nome, videata, intera, altezza });
}

// La tavola di confronto: una pagina HTML fotografata a sua volta.
const L = 1280, COL = 470, GAP = 26;
const larghezza = scatti.length * COL + (scatti.length + 1) * GAP;
const html = `<!doctype html><meta charset="utf-8"><style>
 *{box-sizing:border-box} body{margin:0;background:#14161A;color:#E9EBEF;
   font:15px/1.4 system-ui,sans-serif;padding:${GAP}px}
 h1{font-size:19px;margin:0 0 4px;font-weight:600;letter-spacing:.01em}
 .sub{margin:0 0 22px;color:#9AA3AF;font-size:13.5px}
 .riga{display:grid;grid-template-columns:repeat(${scatti.length},${COL}px);gap:${GAP}px}
 .tit{font-size:14px;font-weight:600;margin:0 0 7px}
 .meta{font-size:12px;color:#9AA3AF;margin:0 0 9px}
 .box{background:#1C1F25;border:1px solid #2A2F38;overflow:hidden}
 img{display:block;width:${COL - 2}px}
 .sez{margin:26px 0 9px;font-size:13px;color:#9AA3AF;letter-spacing:.02em}
</style>
<h1>Factory — confronto delle quattro direzioni</h1>
<p class="sub">Prima videata a 1280&times;800, poi la pagina intera in scala. La pastiglia &ldquo;Concept demo&rdquo; e nascosta: e chrome dello strumento, uguale su tutti.</p>
<div class="riga">${scatti.map((s) => `<div><p class="tit">${s.nome}</p>
  <p class="meta">prima videata</p><div class="box"><img src="data:image/png;base64,${s.videata}"></div></div>`).join("")}</div>
<p class="sez">Pagina intera</p>
<div class="riga">${scatti.map((s) => `<div><p class="meta">${s.altezza}px di altezza</p>
  <div class="box"><img src="data:image/png;base64,${s.intera}"></div></div>`).join("")}</div>`;

const pg = await browser.newPage({ viewport: { width: larghezza, height: 1200 }, deviceScaleFactor: 1 });
await pg.setContent(html, { waitUntil: "load" });
await pg.waitForTimeout(600);
await pg.screenshot({ path: USCITA, fullPage: true });
await pg.close();
await browser.close();
console.log(`confronto: ${USCITA} (${Math.round(statSync(USCITA).size / 1024)} KB, ${larghezza}px)`);
