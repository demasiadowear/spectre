// ============================================================
// Da PNG a AVIF e WebP, con le larghezze dello srcset.
//
// Non ritaglia, non ruota, non corregge colore: le immagini arrivano
// gia inquadrate e non si toccano artisticamente. Qui si fa solo
// ricampionamento e ricompressione.
//
// La qualita non e fissa: per ogni file si cerca la piu alta che sta
// sotto `peso_massimo_kb`, cosi il tetto e rispettato per costruzione e
// non per fortuna.
//
// Uso: node scripts/converti-immagini.mjs
// ============================================================
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, "..");
const SORGENTI = join(RADICE, "sorgenti-immagini");
const USCITA = join(RADICE, "public", "img");

const manifest = JSON.parse(readFileSync(join(RADICE, "brief", "asset-manifest.json"), "utf8"));
const mappa = JSON.parse(readFileSync(join(RADICE, "brief", "integration-map.json"), "utf8"));

mkdirSync(USCITA, { recursive: true });

/** Le larghezze da produrre per un asset, dalla mappa di integrazione. */
function larghezze(id) {
  const v = mappa.immagini.find((i) => i.id === id);
  if (!v) throw new Error(`nessuna voce di integrazione per ${id}`);
  return v.srcset_widths;
}

/** La prima qualita della scala che sta sotto il tetto.
 *  Una scala corta batte una ricerca binaria: quasi sempre basta il
 *  primo tentativo, e ogni codifica AVIF costa secondi. */
const SCALA = [62, 54, 46, 38, 30];

async function comprimi(img, formato, tettoByte) {
  let ultimo = null;
  for (const q of SCALA) {
    const buf = formato === "avif"
      ? await img.clone().avif({ quality: q, effort: 4, chromaSubsampling: "4:2:0" }).toBuffer()
      : await img.clone().webp({ quality: q, effort: 4 }).toBuffer();
    ultimo = { buf, q };
    if (buf.length <= tettoByte) return ultimo;
  }
  // Nemmeno la qualita minima sta sotto il tetto: si consegna il file
  // piu piccolo possibile e lo si dichiara.
  return { ...ultimo, sforato: true };
}

const righe = [];
let totaleAvifPiena = 0;

for (const a of manifest.asset) {
  const sorgente = join(SORGENTI, a.filename);
  if (!existsSync(sorgente)) throw new Error(`manca il sorgente ${a.filename}`);

  // Il checksum si ricontrolla qui: se qualcuno tocca un PNG fra la
  // verifica e la conversione, la build si ferma.
  const sha = createHash("sha256").update(readFileSync(sorgente)).digest("hex");
  if (sha !== a.checksum_sha256) {
    throw new Error(`checksum diverso per ${a.filename}\n  atteso ${a.checksum_sha256}\n  trovato ${sha}`);
  }

  const meta = await sharp(sorgente).metadata();
  if (meta.width !== a.dimensioni.larghezza || meta.height !== a.dimensioni.altezza) {
    throw new Error(`${a.filename}: ${meta.width}x${meta.height}, il manifest dice ${a.dimensioni.larghezza}x${a.dimensioni.altezza}`);
  }

  const ws = larghezze(a.id);
  const piena = Math.max(...ws);
  if (piena > meta.width) {
    throw new Error(`${a.id}: lo srcset chiede ${piena}px ma il sorgente ne ha ${meta.width}. Niente ingrandimenti.`);
  }

  for (const w of ws) {
    const h = Math.round((w / a.dimensioni.larghezza) * a.dimensioni.altezza);
    // Il tetto vale alla larghezza piena; alle larghezze minori scala
    // col numero di pixel.
    const quota = (w * h) / (a.dimensioni.larghezza * a.dimensioni.altezza);
    const tetto = Math.round(a.peso_massimo_kb * 1024 * quota);

    const ridotta = sharp(sorgente).resize({ width: w, kernel: "lanczos3" });

    for (const formato of ["avif", "webp"]) {
      const tettoF = formato === "webp" ? Math.round(tetto * 1.35) : tetto;
      const { buf, q, sforato } = await comprimi(ridotta, formato, tettoF);
      const nome = `${a.id}-${w}.${formato}`;
      writeFileSync(join(USCITA, nome), buf);
      if (w === piena) {
        if (formato === "avif") totaleAvifPiena += buf.length;
        righe.push({
          id: a.id, formato, larghezza: w, kb: +(buf.length / 1024).toFixed(1),
          tetto_kb: a.peso_massimo_kb, q, sforato: !!sforato,
        });
      }
    }
  }
  process.stdout.write(`  ${a.id}: ${ws.length} larghezze x 2 formati\n`);
}

console.log("\nAlla larghezza piena:");
for (const r of righe.filter((r) => r.formato === "avif")) {
  const segno = r.sforato ? "  ✗ SFORA" : "";
  console.log(`  ${r.id.padEnd(24)} AVIF ${String(r.kb).padStart(6)} KB / ${r.tetto_kb} KB  q${r.q}${segno}`);
}
console.log(`\nTotale AVIF a larghezza piena: ${(totaleAvifPiena / 1024 / 1024).toFixed(2)} MB (tetto 2,00 MB)`);
const sforati = righe.filter((r) => r.sforato);
if (sforati.length) {
  console.log(`\nATTENZIONE: ${sforati.length} file non stanno sotto il tetto nemmeno alla qualita minima.`);
  process.exitCode = 1;
}

writeFileSync(join(RADICE, "brief", "conversione-report.json"),
  JSON.stringify({ data: new Date().toISOString().slice(0, 10), totale_avif_piena_byte: totaleAvifPiena, file: righe }, null, 2));
