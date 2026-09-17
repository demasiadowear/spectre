// ============================================================
// La mappa di integrazione e un contratto, non un suggerimento.
//
// Per ogni immagine dichiarata in integration-map.json si controlla
// sulla pagina viva che il browser abbia davvero applicato: il punto
// focale, il `sizes`, la media query che sceglie la variante, la
// priorita di caricamento, le dimensioni intrinseche dichiarate.
//
// Si controlla sull'elemento calcolato, non sul sorgente: un attributo
// scritto giusto e sovrascritto dal CSS resterebbe comunque sbagliato.
//
// Uso: node scripts/verifica-mappa.mjs [dir-dist]
// ============================================================
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, "..");
const DIST = resolve(process.argv[2] ?? join(RADICE, "dist"));
const PORTA = 4451;

const mappa = JSON.parse(readFileSync(join(RADICE, "brief", "integration-map.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(RADICE, "brief", "asset-manifest.json"), "utf8"));

const MIME = {
  ".html": "text/html;charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".avif": "image/avif",
};
const srv = createServer((q, r) => {
  const p = decodeURIComponent((q.url ?? "/").split("?")[0]);
  let f = join(DIST, p === "/" ? "/index.html" : p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
  if (!existsSync(f)) { r.writeHead(404); return r.end("404"); }
  const b = readFileSync(f);
  r.writeHead(200, { "Content-Type": MIME[extname(f)] ?? "application/octet-stream", "Content-Length": b.length });
  r.end(b);
});
await new Promise((r) => srv.listen(PORTA, "127.0.0.1", r));

const br = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const esiti = [];
const ok = (t) => esiti.push({ ok: true, t });
const no = (t, d) => esiti.push({ ok: false, t, d });

/** Il punto focale del manifest tradotto come dice la convenzione. */
function focaleAttesa(id) {
  const a = manifest.asset.find((x) => x.id === id);
  if (!a || !a.focal_point) return null;
  return `${Math.round(a.focal_point.x * 100)}% ${Math.round(a.focal_point.y * 100)}%`;
}

for (const vp of [{ n: "mobile", w: 390, h: 844 }, { n: "desktop", w: 1440, h: 900 }]) {
  const pg = await br.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, locale: "it-IT" });
  await pg.goto(`http://127.0.0.1:${PORTA}/index.html`, { waitUntil: "networkidle" });
  await pg.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += Math.round(innerHeight * 0.8)) {
      scrollTo(0, y); await new Promise((r) => setTimeout(r, 90));
    }
    await Promise.race([
      Promise.all([...document.querySelectorAll("img")].filter((i) => !i.complete)
        .map((i) => new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }))),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
    scrollTo(0, 0);
  });
  await pg.waitForTimeout(500);

  const visti = await pg.evaluate(() =>
    [...document.querySelectorAll("img")].map((i) => {
      const s = getComputedStyle(i);
      return {
        src: i.currentSrc.replace(location.origin, ""),
        objectFit: s.objectFit,
        objectPosition: s.objectPosition,
        sizes: i.getAttribute("sizes") ?? i.parentElement?.querySelector("source")?.getAttribute("sizes") ?? "",
        loading: i.loading,
        fetchpriority: i.getAttribute("fetchpriority") ?? "auto",
        decoding: i.getAttribute("decoding") ?? "auto",
        w: i.getAttribute("width"), h: i.getAttribute("height"),
        caricata: i.complete && i.naturalWidth > 0,
      };
    }));

  for (const v of mappa.immagini) {
    // Le due varianti della hero si escludono per media query: su ogni
    // viewport ne deve comparire esattamente una.
    const atteso = v.media_query
      ? (vp.n === "mobile" ? v.media_query.includes("max-width") : v.media_query.includes("min-width"))
      : true;
    const trovato = visti.find((x) => x.src.includes(`/${v.id}-`));

    if (!atteso) {
      trovato ? no(`${vp.n} ${v.id}: non doveva comparire (${v.media_query})`, trovato.src)
              : ok(`${vp.n} ${v.id}: correttamente assente (${v.media_query})`);
      continue;
    }
    if (!trovato) { no(`${vp.n} ${v.id}: nessuna <img> con questa sorgente`); continue; }
    if (!trovato.caricata) { no(`${vp.n} ${v.id}: non si e caricata`, trovato.src); continue; }

    // La larghezza scelta deve stare fra quelle previste.
    const wScelta = Number(trovato.src.match(/-(\d+)\.(avif|webp)$/)?.[1] ?? 0);
    v.srcset_widths.includes(wScelta)
      ? ok(`${vp.n} ${v.id}: larghezza ${wScelta} fra ${v.srcset_widths.join("/")}`)
      : no(`${vp.n} ${v.id}: larghezza ${wScelta} fuori da ${v.srcset_widths.join("/")}`);

    // Il formato deve essere AVIF: se il browser lo supporta e sceglie
    // WebP, il <source> AVIF non sta funzionando.
    /\.avif$/.test(trovato.src)
      ? ok(`${vp.n} ${v.id}: servito in AVIF`)
      : no(`${vp.n} ${v.id}: servito in ${extname(trovato.src)}, non AVIF`);

    trovato.objectFit === v.object_fit
      ? ok(`${vp.n} ${v.id}: object-fit ${v.object_fit}`)
      : no(`${vp.n} ${v.id}: object-fit ${trovato.objectFit}, atteso ${v.object_fit}`);

    // Il punto focale deve coincidere sia con la mappa sia con il
    // manifest: se i due divergono, lo dico.
    const normal = (s) => s.replace(/\s+/g, " ").trim();
    normal(trovato.objectPosition) === normal(v.object_position)
      ? ok(`${vp.n} ${v.id}: object-position ${v.object_position}`)
      : no(`${vp.n} ${v.id}: object-position ${trovato.objectPosition}, la mappa dice ${v.object_position}`);
    const fm = focaleAttesa(v.id);
    if (fm && normal(fm) !== normal(v.object_position)) {
      no(`${v.id}: il focal_point del manifest (${fm}) non coincide con la mappa (${v.object_position})`);
    }

    normal(trovato.sizes) === normal(v.sizes)
      ? ok(`${vp.n} ${v.id}: sizes "${v.sizes}"`)
      : no(`${vp.n} ${v.id}: sizes "${trovato.sizes}", attesi "${v.sizes}"`);

    trovato.loading === v.loading
      ? ok(`${vp.n} ${v.id}: loading ${v.loading}`)
      : no(`${vp.n} ${v.id}: loading ${trovato.loading}, atteso ${v.loading}`);

    trovato.fetchpriority === v.fetchpriority
      ? ok(`${vp.n} ${v.id}: fetchpriority ${v.fetchpriority}`)
      : no(`${vp.n} ${v.id}: fetchpriority ${trovato.fetchpriority}, atteso ${v.fetchpriority}`);

    trovato.decoding === v.decoding
      ? ok(`${vp.n} ${v.id}: decoding ${v.decoding}`)
      : no(`${vp.n} ${v.id}: decoding ${trovato.decoding}, atteso ${v.decoding}`);

    // Senza width/height dichiarati non c'e nessuna garanzia sul CLS.
    (trovato.w && trovato.h)
      ? ok(`${vp.n} ${v.id}: dimensioni dichiarate ${trovato.w}x${trovato.h}`)
      : no(`${vp.n} ${v.id}: manca width o height sull <img>`);
  }

  // Il preload deve essere uno solo per viewport, e puntare alla hero
  // giusta: due preload significherebbero scaricare due volte la LCP.
  const preload = await pg.evaluate(() =>
    [...document.querySelectorAll('link[rel="preload"][as="image"]')].map((l) => ({
      media: l.getAttribute("media") ?? "", srcset: l.getAttribute("imagesrcset") ?? "",
      sizes: l.getAttribute("imagesizes") ?? "",
      attivo: !l.media || matchMedia(l.media).matches,
    })));
  const attivi = preload.filter((p) => p.attivo);
  attivi.length === 1
    ? ok(`${vp.n}: un solo preload immagine attivo (${attivi[0].media || "senza media"})`)
    : no(`${vp.n}: ${attivi.length} preload immagine attivi`, JSON.stringify(preload));

  await pg.close();
}

await br.close();
srv.close();

const falliti = esiti.filter((e) => !e.ok);
for (const e of falliti) console.log(`  ✗ ${e.t}${e.d ? `\n      ${e.d}` : ""}`);
console.log(`\n${esiti.length - falliti.length}/${esiti.length} controlli superati.`);
if (falliti.length) process.exitCode = 1;
