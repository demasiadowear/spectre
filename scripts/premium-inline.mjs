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

// I modulepreload non servono più: il modulo è dentro la pagina.
html = html.replace(/<link[^>]+rel=["']modulepreload["'][^>]*>/g, "");
// Nemmeno i preload dei font: sono dentro il CSS come data URI, e un
// preload verso un file che non esiste è solo una richiesta fallita.
html = html.replace(/<link[^>]+rel=["']preload["'][^>]*as=["']font["'][^>]*>\s*/g, "");

writeFileSync(OUT, html);
const kb = Math.round(statSync(OUT).size / 1024);
console.log(`${basename(OUT)}: ${kb} KB, autonomo`);
if (/src=["']\.?\/?assets/.test(html) || /href=["']\.?\/?assets/.test(html)) {
  console.log("ATTENZIONE: restano riferimenti a file esterni");
  process.exitCode = 1;
}
