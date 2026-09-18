import assert from "node:assert/strict";
import { test } from "node:test";

import { RIFERIMENTO_FOTO, urlFotoProvider, urlMediaProvider, urlSchedaMaps } from "../../lib/collector/places";

// ============================================================
// La rotta che mostra una fotografia di Google senza copiarla.
//
// Due cose possono andare storte qui, e nessuna delle due si vede
// guardando la pagina:
//
//  1. la chiave API finisce nel browser, e diventa pubblica;
//  2. la rotta accetta un URL invece di un riferimento, e diventa un
//     proxy aperto: chiunque abbia una sessione se la fa usare per
//     scaricare qualunque cosa dal nostro server.
//
// Il secondo e il piu facile da introdurre per comodita, ed e per
// questo che l'ingresso e un'espressione regolare stretta e non un
// controllo di prefisso.
// ============================================================

test("foto: l'URL per il browser non contiene MAI la chiave", () => {
  const u = urlFotoProvider("places/ChIJabc/photos/AF1xyz", 800);
  assert.ok(u.startsWith("/api/collector/foto?"), `deve passare dal nostro server: ${u}`);
  assert.ok(!/key=/i.test(u), "nessuna chiave nell'URL che finisce nella pagina");
  assert.ok(!u.includes("googleapis.com"), "il browser non deve nemmeno parlare col provider");
});

test("foto: l'URL del server contiene la chiave e non esce mai dal server", () => {
  const u = urlMediaProvider("places/ChIJabc/photos/AF1xyz", 800, "CHIAVE-SEGRETA");
  assert.ok(u.includes("CHIAVE-SEGRETA"), "questo e l'URL che usa il server");
  assert.ok(u.startsWith("https://places.googleapis.com/"), `host inatteso: ${u}`);
});

test("foto: solo un riferimento Places, mai un URL", () => {
  // Il caso che conta: se la rotta accettasse un URL, sarebbe un modo
  // di far scaricare al nostro server qualunque cosa — compresi gli
  // indirizzi interni della rete su cui gira.
  const rifiutati = [
    "https://example.com/foo.jpg",
    "http://169.254.169.254/latest/meta-data/",
    "places/../../etc/passwd",
    "places/ChIJabc/photos/../../x",
    "file:///etc/passwd",
    "",
    "   ",
    "places//photos/AF1",
    "places/ChIJabc/photos/",
    `places/ChIJabc/photos/${"A".repeat(513)}`,
  ];
  for (const r of rifiutati) {
    assert.equal(RIFERIMENTO_FOTO.test(r.trim()), false, `accettato un riferimento che non lo e: ${r}`);
  }

  const accettati = [
    "places/ChIJabc/photos/AF1xyz",
    "places/ChIJ0123456789_-/photos/AF1QipM_-0123",
  ];
  for (const r of accettati) {
    assert.equal(RIFERIMENTO_FOTO.test(r), true, `riferimento valido rifiutato: ${r}`);
  }
});

test("foto: il link alla scheda Google si costruisce dal place_id", () => {
  const u = urlSchedaMaps("ChIJabc");
  assert.ok(u.includes("ChIJabc"));
  assert.ok(u.startsWith("https://www.google.com/maps/"), `non porta a Google Maps: ${u}`);
});
