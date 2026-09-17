// ============================================================
// I due font variabili, ridotti ai caratteri che la pagina usa davvero.
//
// I file di @fontsource contengono l'intera copertura latina estesa.
// La dichiarazione `unicode-range` dice al browser quando usarli, non
// li rimpicciolisce: il telefono scarica comunque 136 KB per scrivere
// un menu in italiano.
//
// Qui si legge il testo dalla pagina costruita, si aggiungono i segni
// che servono comunque (punteggiatura tipografica, accenti, cifre) e si
// taglia il resto. Gli assi variabili restano intatti: i pesi usati dal
// CSS devono continuare a esistere.
//
// Non e una scelta estetica: stesso carattere, stesso disegno, stessi
// pesi. Cambia solo quanto pesa il file.
//
// Uso: node scripts/sottoinsiemi-font.mjs
// ============================================================
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, "..");
const SORGENTI = join(RADICE, "node_modules");
const USCITA = join(RADICE, "public", "font");
mkdirSync(USCITA, { recursive: true });

// Il testo della pagina: e da qui che si sa cosa serve.
const html = readFileSync(join(RADICE, "index.html"), "utf8");
const testo = html
  .replace(/<script[\s\S]*?<\/script>/g, " ")
  .replace(/<style[\s\S]*?<\/style>/g, " ")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<[^>]+>/g, " ");

// Oltre a quello che c'e oggi: le cifre e i mesi servono al modulo di
// prenotazione, che scrive date a runtime, e la punteggiatura
// tipografica serve a non far cadere un apostrofo su un ripiego.
const SEMPRE = "0123456789 .,;:!?'\"()[]{}/\\-–—…«»“”‘’·•&@#%+=<>*_|~^$€£"
  + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  + "àáâäãåèéêëìíîïòóôöõùúûüçñÀÁÂÄÃÅÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑ"
  + " ​‐‑";

const glifi = [...new Set([...testo, ...SEMPRE])]
  .filter((c) => c.codePointAt(0) > 31)
  .sort();

// Le sorgenti sono quelle gia spedite, identificate per checksum, non
// quelle che sembrano equivalenti dal nome: @fontsource pubblica lo
// stesso carattere in piu combinazioni di assi variabili, e Bricolage
// e in pagina nella versione con l'asse di larghezza. Sottoinsiemare
// dalla versione con l'asse di peso dava lo stesso carattere con altre
// metriche: il tasto della hero passava da 226 a 232 px.
const FONT = [
  {
    nome: "bricolage",
    da: "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wdth-normal.woff2",
    sha: "c7e1602806bbd726cc99bb1320625f3ae315c1c5831b152cc1510c1e14e7396b",
  },
  {
    nome: "newsreader",
    da: "@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2",
    sha: "62981321d9a3cc7a61a73792729043703fd6112da86e8ec848bb57f088578757",
  },
];

console.log(`${glifi.length} caratteri distinti nella pagina.\n`);
let prima = 0, dopo = 0;

for (const f of FONT) {
  const ingresso = join(SORGENTI, f.da);
  const uscita = join(USCITA, `${f.nome}.woff2`);

  // Se npm aggiorna il pacchetto e cambia il file sotto, il carattere
  // cambia disegno senza che nessuno se ne accorga: qui si ferma.
  const sha = createHash("sha256").update(readFileSync(ingresso)).digest("hex");
  if (sha !== f.sha) {
    throw new Error(`${f.nome}: la sorgente non e quella attesa\n  atteso  ${f.sha}\n  trovato ${sha}`);
  }
  const kbPrima = statSync(ingresso).size;

  execFileSync("python3", ["-m", "fontTools.subset", ingresso,
    `--text=${glifi.join("")}`,
    "--flavor=woff2",
    `--output-file=${uscita}`,
    // Gli assi variabili non si toccano: il CSS chiede pesi da 200 a
    // 800 e devono continuare a esistere tutti.
    "--layout-features=kern,liga,clig,calt,frac,onum,tnum",
    "--no-hinting",
    "--desubroutinize",
    "--name-IDs=*",
    "--drop-tables+=DSIG",
  ], { stdio: ["ignore", "ignore", "inherit"] });

  const kbDopo = statSync(uscita).size;
  prima += kbPrima; dopo += kbDopo;
  console.log(`  ${f.nome.padEnd(12)} ${(kbPrima / 1024).toFixed(1).padStart(6)} KB -> ${(kbDopo / 1024).toFixed(1).padStart(6)} KB  (-${Math.round((1 - kbDopo / kbPrima) * 100)}%)`);
}

console.log(`\n  ${"totale".padEnd(12)} ${(prima / 1024).toFixed(1).padStart(6)} KB -> ${(dopo / 1024).toFixed(1).padStart(6)} KB  (-${Math.round((1 - dopo / prima) * 100)}%)`);
writeFileSync(join(RADICE, "brief", "font-report.json"), JSON.stringify({
  data: new Date().toISOString().slice(0, 10),
  caratteri: glifi.length, byte_prima: prima, byte_dopo: dopo,
}, null, 2));
