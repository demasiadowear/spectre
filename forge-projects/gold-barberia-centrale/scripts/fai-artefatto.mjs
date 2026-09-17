// Trasforma il file autonomo nella pagina-artefatto.
//
// L'artefatto non ha un documento suo: riceve titolo, stili e contenuto
// e li monta dentro uno scheletro già esistente. Quindi niente doctype,
// niente <html>, niente <head>, niente <body> — e uno stile in più che
// riprende il fondo scuro, perché lo scheletro è chiaro.
//
// Uso: node scripts/fai-artefatto.mjs <autonomo.html> <artefatto.html>
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { basename } from "node:path";

const [, , ingresso = "barberia-centrale-autonomo.html", uscita = "artefatto-barberia-centrale.html"] =
  process.argv;

const doc = readFileSync(ingresso, "utf8");

const titolo = doc.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "Anteprima";
const stili = [...doc.matchAll(/<style>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const corpo = doc.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1];
if (!corpo) { console.error("nessun <body> in " + ingresso); process.exit(1); }

const tema = `<style>
  /* La pagina artefatto vive dentro uno scheletro con fondo chiaro e
     font di sistema: qui si riprende il controllo, perché questo sito
     ha un'identità voluta e non segue il tema di chi guarda. */
  :root { color-scheme: dark; }
  body { background: var(--fondo); color: var(--osso); margin: 0; }
</style>`;

writeFileSync(
  uscita,
  `<title>Anteprima ${titolo.replace(/\s*—.*$/, "")}</title>\n${stili.join("\n")}\n${tema}\n${corpo.trim()}\n`,
);
console.log(`${basename(uscita)}: ${Math.round(statSync(uscita).size / 1024)} KB`);
