// Ricopia src/rasoio.svg.html dentro index.html, in linea.
//
// L'SVG sta nell'HTML e non viene iniettato dal JS: iniettarlo dopo il
// primo paint spostava il contenuto (CLS) e senza JavaScript lasciava un
// buco. Ma allora esiste in due posti, e a mano si disallineano. Questo
// script tiene la copia allineata alla sorgente.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const qui = dirname(fileURLToPath(import.meta.url));
const indice = join(qui, "..", "index.html");
const svg = readFileSync(join(qui, "..", "src", "rasoio.svg.html"), "utf8").trim();

const html = readFileSync(indice, "utf8");
const blocco = /<div class="apertura-oggetto">[\s\S]*?<\/svg><\/div>/;
if (!blocco.test(html)) {
  console.error("blocco .apertura-oggetto non trovato in index.html");
  process.exit(1);
}
writeFileSync(indice, html.replace(blocco, `<div class="apertura-oggetto">${svg}</div>`));
console.log("rasoio allineato");
