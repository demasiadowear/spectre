// ============================================================
// Impacchetta la build in UN SOLO file HTML autonomo.
//
// CSS, JavaScript e font finiscono dentro la pagina: font come data URI
// nelle @font-face, script come modulo inline. Il risultato si apre con
// un doppio clic, senza server, senza rete, senza build — che è quello
// che serve quando non si può pubblicare una preview.
//
// Uso: node scripts/premium-inline.mjs <dist> <file-di-uscita>
// ============================================================

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";

const DIST = resolve(process.argv[2] ?? "dist");
const OUT = resolve(process.argv[3] ?? "barberia-centrale.html");

const MIME_FONT = { ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };

let html = readFileSync(join(DIST, "index.html"), "utf8");

/** Sostituisce gli url(...) di un CSS con data URI. */
function inlineFontUrls(css, cssDir) {
  return css.replace(/url\(([^)]+)\)/g, (intero, grezzo) => {
    const ref = grezzo.trim().replace(/^["']|["']$/g, "");
    if (/^data:|^https?:/.test(ref)) return intero;
    const senzaQuery = ref.split("?")[0];
    // Un riferimento che parte da "/" è relativo alla radice del sito,
    // non alla cartella del CSS: resolve() lo prenderebbe per un percorso
    // assoluto sul disco e non troverebbe nulla.
    const file = senzaQuery.startsWith("/")
      ? join(DIST, senzaQuery)
      : resolve(cssDir, senzaQuery);
    if (!existsSync(file)) return intero;
    const ext = file.slice(file.lastIndexOf("."));
    const mime = MIME_FONT[ext];
    // Solo woff2: il woff e il ttf sono i fallback per browser che qui
    // non interessano, e raddoppierebbero il peso del file.
    if (mime !== "font/woff2") return "url(about:blank)";
    const b64 = readFileSync(file).toString("base64");
    return `url("data:${mime};base64,${b64}")`;
  });
}

// --- CSS ---
html = html.replace(
  /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g,
  (_m, href) => {
    const file = join(DIST, href.replace(/^\.?\//, ""));
    if (!existsSync(file)) return "";
    let css = readFileSync(file, "utf8");
    css = inlineFontUrls(css, dirname(file));
    // Le @font-face che puntano a about:blank (woff/ttf) vanno tolte:
    // un src non valido fa fallire l'intera regola su alcuni browser.
    css = css.replace(/@font-face\s*{[^}]*url\(about:blank\)[^}]*}/g, "");
    return `<style>\n${css}\n</style>`;
  },
);

// --- JS ---
html = html.replace(
  /<script[^>]+type=["']module["'][^>]*src=["']([^"']+)["'][^>]*><\/script>/g,
  (_m, src) => {
    const file = join(DIST, src.replace(/^\.?\//, ""));
    if (!existsSync(file)) return "";
    const js = readFileSync(file, "utf8");
    return `<script type="module">\n${js}\n</script>`;
  },
);

// --- Immagini ---
// Un file autonomo non può puntare a /img/: o le fotografie entrano
// come data URI, o la pagina si apre vuota. Dentro un <picture> si
// tiene una sola variante per art direction, all'AVIF di larghezza
// intermedia: le altre larghezze dello srcset servono a un browser che
// sceglie, e qui non c'è niente da scegliere. Il base64 costa un terzo
// in più del file, quindi prendere la larghezza piena triplicherebbe
// il peso senza che si veda la differenza.
const MIME_IMG = { ".avif": "image/avif", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

function dataUri(rif) {
  const pulito = rif.trim().split(" ")[0].split("?")[0];
  if (/^data:|^https?:/.test(pulito)) return null;
  const file = join(DIST, pulito.replace(/^\.?\//, ""));
  if (!existsSync(file)) return null;
  const mime = MIME_IMG[file.slice(file.lastIndexOf("."))];
  if (!mime) return null;
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

/** La candidata di mezzo di uno srcset `url 900w, url 1350w, ...`. */
function intermedia(srcset) {
  const c = srcset.split(",").map((s) => s.trim()).filter(Boolean);
  if (!c.length) return null;
  return c[Math.floor((c.length - 1) / 2)].split(/\s+/)[0];
}

let inlineate = 0, byteImmagini = 0;
html = html.replace(/<picture\b[\s\S]*?<\/picture>/g, (blocco) => {
  // Il WebP è il ripiego per chi non legge l'AVIF: tenerlo qui
  // raddoppierebbe il peso del file per un caso che non si verifica.
  let b = blocco.replace(/<source\b[^>]*type=["']image\/webp["'][^>]*>\s*/g, "");
  b = b.replace(/<source\b([^>]*)>/g, (tag, attr) => {
    const ss = attr.match(/srcset=["']([^"']+)["']/)?.[1];
    const uri = ss && dataUri(intermedia(ss));
    if (!uri) return tag;
    inlineate++; byteImmagini += uri.length;
    return `<source${attr.replace(/srcset=["'][^"']+["']/, `srcset="${uri}"`).replace(/\s*sizes=["'][^"']*["']/, "")}>`;
  });
  // L'<img> finale puntava al WebP: senza i suoi <source> resterebbe
  // l'unica sorgente e il file non esiste più nel documento.
  b = b.replace(/<img\b([^>]*)>/, (tag, attr) => {
    const src = attr.match(/src=["']([^"']+)["']/)?.[1];
    const uri = src && (dataUri(src.replace(/\.webp$/, ".avif")) ?? dataUri(src));
    if (!uri) return tag;
    inlineate++; byteImmagini += uri.length;
    return `<img${attr.replace(/src=["'][^"']+["']/, `src="${uri}"`)}>`;
  });
  return b;
});

// Gli <img> fuori da un <picture>.
html = html.replace(/<img\b([^>]*)>/g, (tag, attr) => {
  const src = attr.match(/src=["']([^"']+)["']/)?.[1];
  if (!src || /^data:/.test(src)) return tag;
  const uri = dataUri(src);
  if (!uri) return tag;
  inlineate++; byteImmagini += uri.length;
  return `<img${attr.replace(/src=["'][^"']+["']/, `src="${uri}"`).replace(/\s*srcset=["'][^"']*["']/, "").replace(/\s*sizes=["'][^"']*["']/, "")}>`;
});

// Un preload verso /img/ che non esiste più è solo un errore di rete
// all'apertura: la fotografia è già dentro la pagina.
html = html.replace(/<link[^>]+rel=["']preload["'][^>]*as=["']image["'][^>]*>\s*/g, "");

// I modulepreload non servono più: il modulo è dentro la pagina.
html = html.replace(/<link[^>]+rel=["']modulepreload["'][^>]*>/g, "");
// Nemmeno i preload dei font: sono dentro il CSS come data URI, e un
// preload verso un file che non esiste è solo una richiesta fallita.
html = html.replace(/<link[^>]+rel=["']preload["'][^>]*as=["']font["'][^>]*>\s*/g, "");

writeFileSync(OUT, html);
const kb = Math.round(statSync(OUT).size / 1024);
console.log(`${basename(OUT)}: ${kb} KB, autonomo`);
if (inlineate) {
  console.log(`  ${inlineate} immagini come data URI, ${Math.round(byteImmagini / 1024)} KB in base64`);
}

// Un riferimento rimasto a un file del build significa che aprendo la
// pagina da sola qualcosa manca: meglio saperlo qui.
const rimasti = [...html.matchAll(/(?:src|href|srcset)=["'](\/(?:assets|img|font)\/[^"']+)["']/g)]
  .map((m) => m[1]);
if (rimasti.length) {
  console.log(`ATTENZIONE: restano ${rimasti.length} riferimenti a file esterni:`);
  for (const r of [...new Set(rimasti)].slice(0, 10)) console.log(`  ${r}`);
  process.exitCode = 1;
}
