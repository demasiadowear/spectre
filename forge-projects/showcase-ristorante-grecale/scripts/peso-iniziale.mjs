// ============================================================
// Quanto pesa davvero la pagina PRIMA che l'utente tocchi qualcosa.
//
// Non si contano i file sul disco: si contano i byte che il browser
// chiede spontaneamente su un telefono, dal primo colpo fino a rete
// ferma. Le altre larghezze dello srcset e i formati scartati stanno
// in `dist/` ma non li scarica nessuno, e non devono finire nel conto.
//
// Il numero che vale e `transferSize` della Resource Timing API: e
// quello che passa sul filo, compressione inclusa.
//
// Uso: node scripts/peso-iniziale.mjs [dir-dist]
// ============================================================
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createGzip } from "node:zlib";
import { chromium } from "playwright-core";

const DIST = resolve(process.argv[2] ?? "dist");
const PORTA = 4412;

const MIME = {
  ".html": "text/html;charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".avif": "image/avif", ".jpg": "image/jpeg",
};
// Solo testo: immagini e font sono gia compressi, gzippare peggiora.
const COMPRIMIBILE = new Set([".html", ".js", ".css", ".svg", ".json"]);

const srv = createServer((q, r) => {
  const p = decodeURIComponent((q.url ?? "/").split("?")[0]);
  let f = join(DIST, p === "/" ? "/index.html" : p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
  if (!existsSync(f)) { r.writeHead(404); return r.end("404"); }
  const est = extname(f);
  const b = readFileSync(f);
  const tipo = MIME[est] ?? "application/octet-stream";
  // Un server serio serve gzip: misurare senza sarebbe misurare una
  // configurazione che nessuno metterebbe in produzione.
  if (COMPRIMIBILE.has(est) && /gzip/.test(q.headers["accept-encoding"] ?? "")) {
    r.writeHead(200, { "Content-Type": tipo, "Content-Encoding": "gzip" });
    const z = createGzip({ level: 9 });
    z.pipe(r);
    z.end(b);
    return;
  }
  r.writeHead(200, { "Content-Type": tipo, "Content-Length": b.length });
  r.end(b);
});
await new Promise((r) => srv.listen(PORTA, "127.0.0.1", r));

const br = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const pg = await br.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "it-IT",
});
await pg.goto(`http://127.0.0.1:${PORTA}/index.html`, { waitUntil: "networkidle" });
// Le animazioni d'ingresso e il lazy-load di cio che e gia in vista
// devono aver finito: dopo questo punto, senza toccare nulla, non
// deve partire piu niente.
await pg.waitForTimeout(3000);

const voci = await pg.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const r = performance.getEntriesByType("resource").map((e) => ({
    url: e.name, tipo: e.initiatorType, byte: e.transferSize, decodificati: e.decodedBodySize,
  }));
  return { documento: nav ? nav.transferSize : 0, risorse: r };
});

// Le immagini davvero dipinte, con la sorgente scelta dal browser: e
// la prova che lo srcset sta scegliendo la larghezza giusta e non la
// piu grande.
const dipinte = await pg.evaluate(() =>
  [...document.querySelectorAll("img")].map((i) => {
    const r = i.getBoundingClientRect();
    return {
      scelta: i.currentSrc.replace(location.origin, "") || "—",
      css: `${Math.round(r.width)}x${Math.round(r.height)}`,
      lazy: i.loading === "lazy",
      caricata: i.complete && i.naturalWidth > 0,
      // Sopra la piega al primo colpo: se una di queste manca e un
      // difetto. Le altre non essere caricate e esattamente il punto.
      inVista: r.top < innerHeight && r.bottom > 0,
    };
  }));

await br.close();
srv.close();

const CAT = (u, t) => {
  if (/\.(avif|webp|png|jpg|svg)$/.test(u)) return "immagini";
  if (/\.woff2?$/.test(u)) return "font";
  if (t === "script" || /\.js$/.test(u)) return "javascript";
  if (t === "link" || /\.css$/.test(u)) return "css";
  return "altro";
};

const gruppi = new Map([["documento", { n: 1, byte: voci.documento }]]);
for (const r of voci.risorse) {
  const c = CAT(r.url, r.tipo);
  const g = gruppi.get(c) ?? { n: 0, byte: 0 };
  g.n += 1; g.byte += r.byte;
  gruppi.set(c, g);
}

const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
let totale = 0;
console.log("\nPeso scaricato prima di qualunque interazione (390x844, DPR 2, gzip attivo)\n");
for (const [c, g] of gruppi) {
  totale += g.byte;
  console.log(`  ${c.padEnd(12)} ${String(g.n).padStart(3)} file  ${kb(g.byte).padStart(10)}`);
}
console.log(`  ${"TOTALE".padEnd(12)} ${String([...gruppi.values()].reduce((a, g) => a + g.n, 0)).padStart(3)} file  ${kb(totale).padStart(10)}`);

const immagini = gruppi.get("immagini") ?? { byte: 0 };
const TETTO = 2.5 * 1024 * 1024;
console.log(`\n  immagini ${kb(immagini.byte)} su un tetto di 2560,0 KB — ${immagini.byte <= TETTO ? "sotto" : "SOPRA"}`);

console.log("\nImmagini scaricate (quelle e solo quelle):");
for (const r of voci.risorse.filter((r) => CAT(r.url, r.tipo) === "immagini")) {
  console.log(`  ${kb(r.byte).padStart(10)}  ${r.url.replace(`http://127.0.0.1:${PORTA}`, "")}`);
}

console.log("\nCosa ha scelto il browser per ogni <img>:");
for (const d of dipinte) {
  const stato = d.caricata ? "caricata" : d.inVista ? "MANCANTE" : "rinviata";
  console.log(`  ${stato.padEnd(9)} ${d.css.padStart(9)} css  ${d.lazy ? "lazy " : "eager"}  ${d.scelta}`);
}
const rinviate = dipinte.filter((d) => !d.caricata && !d.inVista).length;
console.log(`\n  ${dipinte.length - rinviate} immagini sopra la piega, ${rinviate} rinviate allo scorrimento.`);

// Un'immagine in vista che non si e caricata e un difetto; una fuori
// vista che non si e caricata e il lavoro fatto bene.
const rotte = dipinte.filter((d) => !d.caricata && d.inVista);
if (rotte.length) {
  console.log(`\nATTENZIONE: ${rotte.length} immagini in vista non si sono caricate.`);
  process.exitCode = 1;
}
