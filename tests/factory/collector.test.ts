import assert from "node:assert/strict";
import { test } from "node:test";

import {
  controlloStatico, indirizzoAmmesso, LIMITI,
} from "../../lib/collector/ssrf";
import { capabilities } from "../../lib/collector/capability";
import {
  contestoConDichiarazioni, eUrlDiProfilo, normalizzaUrlProfilo,
  piattaformaDi, unisciCandidati, usernameDa, valutaProfilo,
  type ContestoIdentita,
} from "../../lib/collector/identity";
import {
  classificaDiritti, costruisciCandidati, distanzaHamming,
  manifestDa, raggruppaDuplicati, selezionaMigliori, stimaRuolo,
  type CandidatoGrezzo, type ContestoMedia,
} from "../../lib/collector/media";
import {
  distanzaMetri, normalizzaNome, risolviCorrispondenza, stessoTelefono,
  type PlacesScheda,
} from "../../lib/collector/places";
import { bandaDa, riconcilia } from "../../lib/collector/collect";
import {
  DirectHtmlProvider, RemoteBrowserProvider, richiedeBrowser,
  sembraRenderizzataDaJs,
} from "../../lib/collector/browser";
import type { DossierFact, MediaCandidate } from "../../types/dossier";

// ============================================================
// Il collector tocca la rete, i diritti d'autore e i dati di attivita
// reali. I test coprono i punti dove un errore NON si vede: una
// guardia SSRF che lascia passare un indirizzo privato, un profilo
// social attribuito all'attivita sbagliata, una fotografia altrui
// classificata come utilizzabile.
// ============================================================

// ----- SSRF -------------------------------------------------------

test("ssrf: gli schemi pericolosi si fermano sulla stringa grezza", () => {
  for (const u of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "  JavaScript:alert(1)",
    "vbscript:msgbox",
    "blob:https://x/y",
  ]) {
    const v = controlloStatico(u);
    assert.equal(v.ok, false, `${u} doveva essere rifiutato`);
    assert.equal(v.reason, "schema_non_ammesso", `${u}: motivo ${v.reason}`);
  }
});

test("ssrf: localhost e le reti private non passano", () => {
  const casi: [string, string][] = [
    ["http://localhost/", "host_locale"],
    ["http://127.0.0.1/", "host_locale"],
    ["http://127.0.0.2/", "rete_privata"],
    ["http://10.1.2.3/", "rete_privata"],
    ["http://192.168.1.1/", "rete_privata"],
    ["http://172.16.0.1/", "rete_privata"],
    ["http://172.31.255.254/", "rete_privata"],
    ["http://0.0.0.0/", "host_locale"],
    ["http://[::1]/", "host_locale"],
    ["http://qualcosa.internal/", "host_locale"],
    ["http://stampante.local/", "host_locale"],
    ["http://app.localhost/", "host_locale"],
  ];
  for (const [u, atteso] of casi) {
    const v = controlloStatico(u);
    assert.equal(v.ok, false, `${u} doveva essere rifiutato`);
    assert.equal(v.reason, atteso, `${u}: motivo ${v.reason}`);
  }
});

test("ssrf: gli endpoint di metadati cloud sono il caso che conta", () => {
  for (const u of [
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://100.100.100.200/",
  ]) {
    const v = controlloStatico(u);
    assert.equal(v.ok, false, `${u} doveva essere rifiutato`);
    assert.ok(
      v.reason === "metadata_endpoint" || v.reason === "rete_privata" || v.reason === "host_locale",
      `${u}: motivo inatteso ${v.reason}`,
    );
  }
});

test("ssrf: 172.15 e 172.32 NON sono private (il blocco e /12, non /8)", () => {
  // Un errore classico e bloccare tutto 172.*, che taglia fuori host
  // pubblici legittimi. La rete privata e 172.16–172.31.
  assert.equal(controlloStatico("http://172.15.0.1/").ok, true);
  assert.equal(controlloStatico("http://172.32.0.1/").ok, true);
  assert.equal(controlloStatico("http://172.16.0.1/").ok, false);
  assert.equal(controlloStatico("http://172.31.0.1/").ok, false);
});

test("ssrf: IPv4 mappato dentro IPv6 non aggira il blocco", () => {
  const v = indirizzoAmmesso("::ffff:127.0.0.1");
  assert.equal(v.ok, false, "::ffff:127.0.0.1 e loopback travestito");
});

test("ssrf: le porte fuori dal web sono rifiutate", () => {
  for (const u of ["http://esempio.it:6379/", "http://esempio.it:22/", "http://esempio.it:5432/"]) {
    const v = controlloStatico(u);
    assert.equal(v.ok, false, `${u} doveva essere rifiutato`);
    assert.equal(v.reason, "porta_non_ammessa");
  }
  assert.equal(controlloStatico("https://esempio.it:443/").ok, true);
  assert.equal(controlloStatico("https://esempio.it/").ok, true);
});

test("ssrf: un URL pubblico normale passa", () => {
  for (const u of ["https://www.esempio.it/chi-siamo", "http://esempio.it:8080/menu"]) {
    const v = controlloStatico(u);
    assert.equal(v.ok, true, `${u} doveva passare, invece: ${v.reason} ${v.detail}`);
  }
});

test("ssrf: i limiti di fetch sono impostati e non aperti", () => {
  assert.ok(LIMITI.timeoutMs > 0 && LIMITI.timeoutMs <= 30_000);
  assert.ok(LIMITI.maxBytes > 0 && LIMITI.maxBytes <= 5_000_000);
  assert.ok(LIMITI.maxRedirects >= 1 && LIMITI.maxRedirects <= 5);
  // Ci si identifica: un collector che si traveste da browser sta
  // aggirando una decisione di chi ospita il sito.
  assert.match(LIMITI.userAgent, /Specter/i);
  assert.doesNotMatch(LIMITI.userAgent, /Mozilla|Chrome|Safari/i);
});

// ----- Capability -------------------------------------------------

test("capability: restituisce booleani e nomi, mai valori", () => {
  const env = {
    GOOGLE_PLACES_API_KEY: "chiave-segretissima-12345",
    TURSO_DATABASE_URL: "libsql://x",
    TURSO_AUTH_TOKEN: "token-segretissimo",
    VERCEL_ENV: "preview",
  } as unknown as NodeJS.ProcessEnv;
  const c = capabilities(env);

  assert.equal(c.google_places_configured, true);
  assert.equal(c.database_configured, true);
  assert.equal(c.storage_configured, false);
  assert.equal(c.browser_worker_configured, false);

  // Il test che conta: nessun frammento di segreto nella risposta.
  const serializzato = JSON.stringify(c);
  assert.ok(!serializzato.includes("chiave-segretissima"), "il valore e uscito");
  assert.ok(!serializzato.includes("token-segretissimo"), "il valore e uscito");
  assert.ok(!serializzato.includes("segret"), "un frammento di segreto e uscito");
  assert.ok(!/\b(12345|chiav)\b/.test(serializzato), "un frammento e uscito");
  // Nemmeno la lunghezza: direbbe quale servizio ha emesso la chiave.
  assert.ok(!serializzato.includes(String("chiave-segretissima-12345".length)));

  // I nomi delle variabili mancanti SI, con lo scope.
  const nomi = c.missing.map((m) => m.name);
  assert.ok(nomi.includes("MEDIA_STORAGE_URL"));
  assert.ok(nomi.includes("BROWSER_WORKER_URL"));
  // Lo scope distingue Preview da Production: e li che si sbaglia, e
  // "preview" da solo non lo direbbe.
  assert.equal(c.missing[0].scope, "vercel:preview");
});

test("capability: una variabile vuota o di soli spazi non e configurata", () => {
  const c = capabilities({ GOOGLE_PLACES_API_KEY: "   " } as unknown as NodeJS.ProcessEnv);
  assert.equal(c.google_places_configured, false);
  assert.ok(c.missing.some((m) => m.name === "GOOGLE_PLACES_API_KEY"));
});

// ----- Corrispondenza Places --------------------------------------

const scheda = (p: Partial<PlacesScheda>): PlacesScheda => ({
  place_id: "", name: "", address: "", lat: 0, lng: 0, phone: "",
  phone_international: "", website: "", maps_url: "", category: "",
  types: [], rating: 0, reviews: 0, business_status: "", hours: [],
  photos: [], summary: "", ...p,
});

test("places: due omonimi nella stessa citta non producono una scelta", () => {
  const candidati = [
    scheda({ place_id: "A", name: "Bar Centrale", address: "Via Roma 1, Bari", phone: "080 111 1111" }),
    scheda({ place_id: "B", name: "Bar Centrale", address: "Via Napoli 9, Bari", phone: "080 222 2222" }),
  ];
  const r = risolviCorrispondenza({ name: "Bar Centrale", city: "Bari" }, candidati);
  assert.equal(r.scelta, null, "con due omonimi non si sceglie");
  assert.equal(r.ambigua, true);
  assert.match(r.motivo, /nome da solo non basta|omonimi/i);
});

test("places: il telefono risolve l'omonimia", () => {
  const candidati = [
    scheda({ place_id: "A", name: "Bar Centrale", address: "Via Roma 1, Bari", phone: "080 111 1111" }),
    scheda({ place_id: "B", name: "Bar Centrale", address: "Via Napoli 9, Bari", phone: "080 222 2222" }),
  ];
  const r = risolviCorrispondenza({ name: "Bar Centrale", city: "Bari", phone: "+39 080 2222222" }, candidati);
  assert.ok(r.scelta, "col telefono si sceglie");
  assert.equal(r.scelta?.scheda.place_id, "B");
  assert.equal(r.scelta?.segnali.telefono, true);
});

test("places: il solo nome identico non basta a dirla sicura", () => {
  const r = risolviCorrispondenza(
    { name: "Pizzeria Da Mario" },
    [scheda({ place_id: "A", name: "Pizzeria Da Mario", address: "Via X 1, Lecce" })],
  );
  assert.equal(r.scelta, null, "il nome da solo non e una corrispondenza");
  assert.equal(r.ambigua, true);
});

test("places: telefoni scritti diversamente sono lo stesso telefono", () => {
  assert.equal(stessoTelefono("+39 080 555 0101", "0805550101"), true);
  assert.equal(stessoTelefono("080/555.01.01", "+390805550101"), true);
  assert.equal(stessoTelefono("080 555 0101", "080 555 0102"), false);
  assert.equal(stessoTelefono("", "0805550101"), false);
});

test("places: la normalizzazione dei nomi toglie le forme societarie", () => {
  assert.equal(normalizzaNome("Bar Centrale S.r.l."), normalizzaNome("bar centrale"));
  assert.equal(normalizzaNome("Caffè Città"), "caffe citta");
});

test("places: la distanza fra coordinate e in metri", () => {
  // Due punti a Bari a circa un chilometro.
  const d = distanzaMetri(41.1171, 16.8719, 41.1261, 16.8719);
  assert.ok(d > 900 && d < 1100, `distanza ${d}`);
  assert.equal(Math.round(distanzaMetri(41.1171, 16.8719, 41.1171, 16.8719)), 0);
});

// ----- Identita ---------------------------------------------------

const ctxBase: ContestoIdentita = {
  nome: "Barberia Centrale",
  citta: "Bari",
  indirizzo: "Via Roma 1, Bari",
  telefono: "080 555 0101",
  place_id: "PLACE123",
  maps_url: "https://maps.google.com/?cid=1",
  official_host: "barberiacentrale.it",
  username_dichiarati: { instagram: ["barberiacentrale"] },
};

test("identity: nome simile e stessa citta NON bastano", () => {
  const c = valutaProfilo(
    { url: "https://instagram.com/barberiacentrale_bari", discovered_via: "linked_page",
      testo: "Barberia Centrale — Bari" },
    { ...ctxBase, username_dichiarati: {} },
  );
  assert.equal(c.status, "ambiguous", `stato ${c.status}: ${c.rationale}`);
  assert.match(c.rationale, /non bastano/i);
  assert.ok(c.confidence < 55, `confidence ${c.confidence} troppo alta per soli segnali deboli`);
});

test("identity: due segnali forti fanno verified", () => {
  const c = valutaProfilo(
    { url: "https://instagram.com/barberiacentrale", discovered_via: "official_site",
      link_esterni: ["https://barberiacentrale.it/"], testo: "Barberia Centrale Bari" },
    ctxBase,
  );
  assert.equal(c.status, "verified", `stato ${c.status}: ${c.rationale}`);
  assert.ok(c.positive_signals.includes("declared_username"));
  assert.ok(c.positive_signals.includes("same_domain"));
  assert.ok(c.positive_signals.includes("reciprocal_link"));
});

test("identity: un solo segnale forte si ferma a probable", () => {
  const c = valutaProfilo(
    { url: "https://instagram.com/altronome", discovered_via: "linked_page",
      link_esterni: ["https://barberiacentrale.it/"] },
    { ...ctxBase, username_dichiarati: {} },
  );
  assert.equal(c.status, "probable", `stato ${c.status}: ${c.rationale}`);
});

test("identity: nome giusto ma telefono diverso viene rifiutato", () => {
  const c = valutaProfilo(
    { url: "https://facebook.com/barberiacentrale", discovered_via: "linked_page",
      telefono: "080 999 9999", testo: "Barberia Centrale Bari" },
    { ...ctxBase, username_dichiarati: {} },
  );
  assert.equal(c.status, "rejected", `stato ${c.status}: ${c.rationale}`);
  assert.equal(c.negative_signals.length, 1);
});

test("identity: browser_required non e «non esiste»", () => {
  const c = valutaProfilo(
    { url: "https://instagram.com/barberiacentrale", discovered_via: "official_site", browser_required: true },
    ctxBase,
  );
  assert.equal(c.status, "browser_required");
  assert.match(c.rationale, /non e un profilo scartato/i);
  assert.notEqual(c.status, "rejected");
});

test("identity: post e storie non sono profili", () => {
  assert.equal(eUrlDiProfilo("https://instagram.com/p/ABC123/"), false);
  assert.equal(eUrlDiProfilo("https://instagram.com/reel/XYZ/"), false);
  assert.equal(eUrlDiProfilo("https://www.facebook.com/sharer.php?u=x"), false);
  assert.equal(eUrlDiProfilo("https://www.facebook.com/plugins/like.php"), false);
  assert.equal(eUrlDiProfilo("https://instagram.com/barberiacentrale"), true);
  assert.equal(eUrlDiProfilo("https://www.tiktok.com/@barberia"), true);
});

test("identity: l'username si estrae per piattaforma", () => {
  assert.equal(usernameDa("https://instagram.com/barberiacentrale/"), "barberiacentrale");
  assert.equal(usernameDa("https://www.tiktok.com/@barberia"), "barberia");
  assert.equal(usernameDa("https://www.linkedin.com/company/acme"), "acme");
  assert.equal(usernameDa("https://www.youtube.com/@canale"), "canale");
  assert.equal(usernameDa("https://instagram.com/p/ABC/"), "");
});

test("identity: due osservazioni dello stesso profilo non sono due candidati", () => {
  const a = valutaProfilo(
    { url: "https://instagram.com/barberiacentrale", discovered_via: "official_site" },
    ctxBase,
  );
  const b = valutaProfilo(
    { url: "https://www.instagram.com/barberiacentrale/?hl=it", discovered_via: "linked_page",
      link_esterni: ["https://barberiacentrale.it/"] },
    ctxBase,
  );
  const uniti = unisciCandidati([a, b]);
  assert.equal(uniti.length, 1, "lo stesso profilo e un candidato solo");
  assert.equal(uniti[0].status, "verified", "unendo le osservazioni si arriva a due segnali forti");
});

test("identity: i link sul sito diventano username dichiarati", () => {
  const ctx = contestoConDichiarazioni(
    { nome: "X", citta: "Bari", indirizzo: "", telefono: "", place_id: "", maps_url: "", official_host: "x.it" },
    ["https://instagram.com/xufficiale", "https://instagram.com/p/post/", "https://facebook.com/xpagina"],
  );
  assert.deepEqual(ctx.username_dichiarati.instagram, ["xufficiale"]);
  assert.deepEqual(ctx.username_dichiarati.facebook, ["xpagina"]);
});

test("identity: la piattaforma si deduce dall'host", () => {
  assert.equal(piattaformaDi("https://www.instagram.com/x"), "instagram");
  assert.equal(piattaformaDi("https://fb.me/x"), "facebook");
  assert.equal(piattaformaDi("https://esempio.it/"), "altro");
  assert.equal(normalizzaUrlProfilo("https://WWW.Instagram.com/X/?hl=it#a"), "https://instagram.com/X");
});

// ----- Browser ----------------------------------------------------

test("browser: le piattaforme social si dichiarano browser_required", async () => {
  const p = new DirectHtmlProvider();
  const r = await p.apri("https://www.instagram.com/qualcuno");
  assert.equal(r.esito, "browser_required");
  assert.notEqual(r.esito, "not_found");
  assert.ok(richiedeBrowser("https://tiktok.com/@x"));
  assert.ok(!richiedeBrowser("https://esempio.it/"));
});

test("browser: una pagina di solo JavaScript non e una pagina vuota", () => {
  const scheletro = `<html><body><div id="root"></div>
    <script src="a.js"></script><script src="b.js"></script><script src="c.js"></script></body></html>`;
  assert.equal(sembraRenderizzataDaJs(scheletro), true);
  const vera = `<html><body><h1>Barberia Centrale</h1><p>${"testo vero ".repeat(60)}</p></body></html>`;
  assert.equal(sembraRenderizzataDaJs(vera), false);
});

test("browser: senza BROWSER_WORKER_URL il remoto dice browser_required, non errore", async () => {
  const p = RemoteBrowserProvider.daEnv({} as NodeJS.ProcessEnv);
  assert.equal(p.configurato, false);
  const r = await p.apri("https://instagram.com/x");
  assert.equal(r.esito, "browser_required");
  assert.match(r.detail, /BROWSER_WORKER_URL/);
});

test("browser: la guardia SSRF vale anche per il browser remoto", async () => {
  const p = new RemoteBrowserProvider({ endpoint: "https://worker.esempio/", token: "", timeoutMs: 1000 });
  const r = await p.apri("http://169.254.169.254/latest/meta-data/");
  assert.equal(r.esito, "blocked");
  assert.ok(r.ssrf === "metadata_endpoint" || r.ssrf === "rete_privata");
});

// ----- Media ------------------------------------------------------

const ctxMedia: ContestoMedia = {
  official_host: "barberiacentrale.it",
  host_ufficiali: ["instagram.com"],
  forniti_dal_cliente: [],
  nome_attivita: "Barberia Centrale",
  categoria: "barbiere",
};

test("media: una foto del sito ufficiale e SOLO demo privata, non pubblica", () => {
  const r = classificaDiritti(
    { url: "https://barberiacentrale.it/foto/sala.jpg", source_page: "https://barberiacentrale.it/", platform: "website" },
    ctxMedia,
  );
  assert.equal(r.rights, "official_public_pending_approval");
  assert.equal(r.scope, "preview_only");
  assert.notEqual(r.scope, "public");
});

test("media: pubblicazione non e diritto di riutilizzo — provenienza ignota si blocca", () => {
  const r = classificaDiritti(
    { url: "https://sitoacaso.com/bella-foto.jpg", source_page: "https://sitoacaso.com/", platform: "altro" },
    ctxMedia,
  );
  assert.equal(r.rights, "unknown");
  assert.equal(r.scope, "blocked");
});

test("media: le foto delle recensioni Google sono degli utenti, non dell'attivita", () => {
  const r = classificaDiritti(
    { url: "https://lh3.googleusercontent.com/p/AAA=w400", source_page: "maps", platform: "google_maps" },
    ctxMedia,
  );
  assert.equal(r.rights, "forbidden");
  assert.equal(r.scope, "blocked");
});

test("media: una foto Places resta provider_rendered e non si copia", () => {
  const r = classificaDiritti(
    { url: "https://places.googleapis.com/v1/places/X/photos/Y/media",
      source_page: "maps", platform: "google_maps",
      provider_reference: "places/X/photos/Y", attribution: "Mario Rossi" },
    ctxMedia,
  );
  assert.equal(r.rights, "provider_rendered");
  assert.equal(r.scope, "preview_only");
  assert.match(r.motivo, /non si copia/i);
});

test("media: solo una dichiarazione esplicita produce customer_owned", () => {
  const url = "https://barberiacentrale.it/foto/sala.jpg";
  const senza = classificaDiritti({ url, source_page: "", platform: "website" }, ctxMedia);
  assert.notEqual(senza.rights, "customer_owned");
  const con = classificaDiritti({ url, source_page: "", platform: "website" },
    { ...ctxMedia, forniti_dal_cliente: [url] });
  assert.equal(con.rights, "customer_owned");
  assert.equal(con.scope, "public");
});

test("media: nessuna immagine nasce approvata", () => {
  const grezzi: CandidatoGrezzo[] = [
    { url: "https://barberiacentrale.it/a.jpg", source_page: "https://barberiacentrale.it/", platform: "website", width: 1600, height: 1200 },
  ];
  const m = manifestDa("lead-1", costruisciCandidati(grezzi, ctxMedia));
  assert.deepEqual(m.approved_ids, [], "l'approvazione e un atto di una persona");
  assert.equal(m.candidates[0].allowed_scope, "preview_only");
});

test("media: le immagini troppo piccole si scartano", () => {
  const grezzi: CandidatoGrezzo[] = [
    { url: "https://barberiacentrale.it/icona.png", source_page: "p", platform: "website", width: 64, height: 64 },
    { url: "https://barberiacentrale.it/vera.jpg", source_page: "p", platform: "website", width: 1600, height: 1200 },
  ];
  const r = costruisciCandidati(grezzi, ctxMedia);
  assert.equal(r.candidati.length, 1);
  assert.match(r.scartati[0].reason, /troppo piccola/);
});

test("media: la stessa foto da URL diversi e un duplicato, non due", () => {
  const c = (id: string, sha: string, phash: string): MediaCandidate => ({
    id, source_url: `https://x/${id}.jpg`, source_page: "", platform: "website",
    copyright_owner: "", attribution: "", observed_at: "", sha256: sha,
    perceptual_hash: phash, width: 1200, height: 800, format: "jpg", filesize: 1,
    orientation: "landscape", probable_role: "venue", quality_score: 50,
    relevance_score: 50, duplicate_group: "", people_present: false,
    rights_status: "official_public_pending_approval", allowed_scope: "preview_only",
    expires_at: "", provider_reference: "", rejected_reason: "",
  });
  // Stesso SHA: file identico servito da due URL.
  const identici = raggruppaDuplicati([c("a", "SHA1", ""), c("b", "SHA1", "")]);
  assert.equal(identici[0].duplicate_group, identici[1].duplicate_group);

  // SHA diverso ma hash percettivo vicino: stessa foto ricompressa.
  const simili = raggruppaDuplicati([
    c("c", "", "ffffffffffffff00"),
    c("d", "", "ffffffffffffff01"),
  ]);
  assert.equal(simili[0].duplicate_group, simili[1].duplicate_group,
    "la stessa foto ricompressa deve finire nello stesso gruppo");

  const diverse = raggruppaDuplicati([c("e", "", "0000000000000000"), c("f", "", "ffffffffffffffff")]);
  assert.notEqual(diverse[0].duplicate_group, diverse[1].duplicate_group);
});

test("media: la distanza di Hamming misura la somiglianza", () => {
  assert.equal(distanzaHamming("0000", "0000"), 0);
  assert.equal(distanzaHamming("0001", "0000"), 1);
  assert.equal(distanzaHamming("ffff", "0000"), 16);
  assert.equal(distanzaHamming("", "0000"), 64);
});

test("media: il ruolo si stima da nome, alt e contesto", () => {
  assert.equal(stimaRuolo({ url: "https://x/logo-nero.svg", source_page: "", platform: "website" }), "logo");
  assert.equal(stimaRuolo({ url: "https://x/img1.jpg", source_page: "", platform: "website", alt: "il nostro team" }), "team");
  assert.equal(stimaRuolo({ url: "https://x/img2.jpg", source_page: "", platform: "website", alt: "orecchiette" }), "unknown");
  assert.equal(stimaRuolo({ url: "https://x/piatto-pasta.jpg", source_page: "", platform: "website" }), "food");
});

test("media: la selezione non pesca due volte dallo stesso duplicato", () => {
  const base = {
    source_page: "", platform: "website" as const, copyright_owner: "", attribution: "",
    observed_at: "", width: 1600, height: 1200, format: "jpg", filesize: 1,
    orientation: "landscape" as const, people_present: false,
    rights_status: "official_public_pending_approval" as const,
    allowed_scope: "preview_only" as const, expires_at: "", provider_reference: "", rejected_reason: "",
  };
  const migliori = selezionaMigliori([
    { ...base, id: "a", source_url: "https://x/a.jpg", sha256: "S", perceptual_hash: "",
      probable_role: "hero", quality_score: 90, relevance_score: 90, duplicate_group: "g1" },
    { ...base, id: "b", source_url: "https://x/b.jpg", sha256: "S", perceptual_hash: "",
      probable_role: "venue", quality_score: 80, relevance_score: 80, duplicate_group: "g1" },
  ]);
  assert.equal(migliori.hero?.id, "a");
  assert.equal(migliori.venue, null, "b e lo stesso file di a: non si usa due volte");
});

test("media: un'immagine bloccata non entra mai nella selezione", () => {
  const migliori = selezionaMigliori([{
    id: "x", source_url: "https://x/x.jpg", source_page: "", platform: "altro",
    copyright_owner: "", attribution: "", observed_at: "", sha256: "", perceptual_hash: "",
    width: 1600, height: 1200, format: "jpg", filesize: 1, orientation: "landscape",
    probable_role: "hero", quality_score: 99, relevance_score: 99, duplicate_group: "g1",
    people_present: false, rights_status: "unknown", allowed_scope: "blocked",
    expires_at: "", provider_reference: "", rejected_reason: "",
  }]);
  assert.equal(migliori.hero, null);
});

// ----- Riconciliazione --------------------------------------------

const f = (field: string, value: string, source_type: DossierFact["source_type"], confidence: number): DossierFact => ({
  field, value, source: source_type, source_type, source_url: "",
  method: "places_details", extraction_method: "places_details",
  observed_at: "", band: bandaDa(confidence), confidence, evidence: "",
  conflict_group: field, usage_scope: "public", status: "proposed",
});

test("riconciliazione: orari discordanti finiscono in conflitto bloccante", () => {
  const r = riconcilia([
    f("hours", "lunedì: 09:00–18:00", "google_places", 90),
    f("hours", "lunedì: 10:00–19:00", "site_structured", 88),
  ]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].field, "hours");
  assert.equal(r.conflicts[0].blocking, true, "gli orari discordanti mandano in REVIEW");
});

test("riconciliazione: un telefono conteso non resta fra i verificati", () => {
  const r = riconcilia([
    f("phone", "080 555 0101", "google_places", 90),
    f("phone", "080 555 9999", "official_site", 85),
  ]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.verified.filter((x) => x.field === "phone").length, 0,
    "un campo conteso non e verificato, nemmeno se la fonte e alta");
  assert.equal(r.probable.filter((x) => x.field === "phone").length, 1);
});

test("riconciliazione: lo stesso telefono scritto diversamente non e un conflitto", () => {
  const r = riconcilia([
    f("phone", "+39 080 555 0101", "google_places", 90),
    f("phone", "0805550101", "official_site", 85),
  ]);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.verified.length, 1);
});

test("riconciliazione: piu servizi sono piu servizi, non un conflitto", () => {
  const r = riconcilia([
    f("services", "taglio", "site_structured", 88),
    f("services", "barba", "site_structured", 88),
    f("services", "colore", "site_structured", 88),
  ]);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.verified.length, 3);
});

test("riconciliazione: il valore inserito a mano vince su tutto", () => {
  const r = riconcilia([
    f("phone", "080 555 0101", "google_places", 90),
    f("phone", "080 555 7777", "manual", 100),
  ]);
  assert.equal(r.conflicts[0].kept.value, "080 555 7777");
  assert.equal(r.conflicts[0].kept.source_type, "manual");
});

test("riconciliazione: la banda deriva dalla confidenza, non viceversa", () => {
  assert.equal(bandaDa(90), "verified");
  assert.equal(bandaDa(80), "verified");
  assert.equal(bandaDa(60), "probable");
  assert.equal(bandaDa(40), "possible");
});
