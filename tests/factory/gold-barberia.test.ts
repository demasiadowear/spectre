// ============================================================
// Il sito gold standard non deve ripetere i dati di contatto.
//
// Nella v3 la sezione "Dove siamo" sembrava comparire due volte: non era
// un doppio render, era il piè di pagina che ripeteva indirizzo e
// telefono subito sotto la sezione che li aveva appena dati. Letto da
// chi scorre, è lo stesso difetto.
//
// Questo test blocca entrambe le forme del problema: indirizzo, numero
// di telefono e link a Maps compaiono una volta sola nel corpo della
// pagina, e le chiamate a `tel:` restano le due volute — la CTA
// dell'apertura e la barra fissa del telefono.
//
// Legge il file sorgente e quello costruito: il JS della pagina non
// inietta contatti, quindi l'HTML È il render. Se un domani li
// iniettasse, il conteggio sul costruito se ne accorgerebbe lo stesso.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RADICE = join(process.cwd(), "forge-projects", "gold-barberia-centrale");
const INDIRIZZO = "Via Nicolò Putignani 71";
const TELEFONO = "080 5240918";

/** Solo il <body>: nel <head> title e meta description citano indirizzo e
 *  numero una volta ciascuno, ed è giusto che lo facciano. */
function corpo(html: string): string {
  const da = html.indexOf("<body");
  assert.ok(da >= 0, "manca <body>");
  return html.slice(da);
}

const quante = (testo: string, ago: string): number => testo.split(ago).length - 1;

function esamina(etichetta: string, html: string): void {
  const b = corpo(html);

  assert.equal(quante(b, "<address"), 1, `${etichetta}: <address> ripetuto`);
  assert.equal(quante(b, INDIRIZZO), 1, `${etichetta}: indirizzo scritto più di una volta`);
  assert.ok(quante(b, TELEFONO) <= 1, `${etichetta}: numero di telefono scritto più di una volta`);
  assert.equal(quante(b, "google.com/maps"), 1, `${etichetta}: più di un link a Maps`);
  assert.equal(quante(b, 'id="contatti"'), 1, `${etichetta}: sezione contatti duplicata`);

  // Le CTA telefoniche sono due, e sono queste: l'utente ne aveva
  // contate troppe, e senza un tetto ne ricrescono.
  const tel = b.match(/href="tel:[^"]*"/g) ?? [];
  assert.equal(tel.length, 2, `${etichetta}: attese 2 chiamate tel:, trovate ${tel.length}`);
  assert.ok(
    /class="azione azione-piena" href="tel:/.test(b),
    `${etichetta}: manca la CTA telefonica dell'apertura`,
  );
  assert.ok(
    /class="chiama-fisso" href="tel:/.test(b),
    `${etichetta}: manca la barra fissa "Chiama"`,
  );

  // Il piè di pagina non rifà la sezione "Dove siamo".
  // Solo l'elemento <footer>: la barra fissa "Chiama" gli sta dopo nel
  // documento, ma non ne fa parte.
  const inizioPiede = b.indexOf("<footer");
  assert.ok(inizioPiede >= 0, `${etichetta}: manca il piè di pagina`);
  const piede = b.slice(inizioPiede, b.indexOf("</footer>", inizioPiede));
  assert.ok(!piede.includes(INDIRIZZO), `${etichetta}: il piè ripete l'indirizzo`);
  assert.ok(!piede.includes(TELEFONO), `${etichetta}: il piè ripete il telefono`);
  assert.ok(!/href="tel:/.test(piede), `${etichetta}: il piè ripete la chiamata`);
  assert.ok(!piede.includes("google.com/maps"), `${etichetta}: il piè ripete Maps`);
}

test("gold standard: i contatti compaiono una volta sola (sorgente)", () => {
  esamina("index.html", readFileSync(join(RADICE, "index.html"), "utf8"));
});

test("gold standard: i contatti compaiono una volta sola (costruito)", (t) => {
  const costruito = join(RADICE, "dist", "index.html");
  if (!existsSync(costruito)) {
    t.skip("dist non costruito");
    return;
  }
  esamina("dist/index.html", readFileSync(costruito, "utf8"));
});
