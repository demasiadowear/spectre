import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_QUERY_PER_LEAD, queryPerLead, risolvi, scopriProfili, urlDalleCitazioni,
  type RispostaGrounded,
} from "../../lib/collector/ricerca";

// ============================================================
// La scoperta social con Google Search.
//
// Serve perche la scoperta partiva dai link SUL sito ufficiale, e
// l'attivita su cui il collector e stato provato per la prima volta un
// sito non ce l'ha: zero profili, nemmeno incerti, mentre un Instagram
// quasi certamente esiste.
//
// LA REGOLA CHE REGGE TUTTO: si accettano solo gli URL presenti nelle
// citazioni della risposta grounded. Mai un URL scritto nel testo del
// modello.
//
// Il motivo non e il purismo. Un modello che scrive
// «instagram.com/trattoriadaprova» produce un indirizzo plausibile, che
// puo benissimo essere il profilo di un'altra attivita o di una
// persona. Metterlo sul sito di un cliente significa pubblicare
// l'Instagram di qualcun altro sotto il nome suo. La citazione invece e
// una pagina che la ricerca ha davvero trovato.
// ============================================================

// ----- La regola ---------------------------------------------------

test("ricerca: si prendono SOLO gli URL delle citazioni, mai quelli scritti dal modello", () => {
  const risposta: RispostaGrounded = {
    candidates: [{
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://citata.example/uno", title: "uno" } },
          { web: { uri: "https://citata.example/due", title: "due" } },
        ],
      },
    }],
  };
  const urls = urlDalleCitazioni(risposta);
  assert.deepEqual(urls, ["https://citata.example/uno", "https://citata.example/due"]);
});

test("ricerca: una risposta senza citazioni non produce nessun candidato", () => {
  // Il modello ha risposto, magari anche con degli indirizzi nel testo,
  // ma la ricerca non ha trovato niente: allora non c'e niente.
  const senza: RispostaGrounded = { candidates: [{ groundingMetadata: {} }] };
  assert.deepEqual(urlDalleCitazioni(senza), []);
  assert.deepEqual(urlDalleCitazioni({ candidates: [{}] }), []);
  assert.deepEqual(urlDalleCitazioni({}), []);
});

test("ricerca: una citazione senza uri non diventa una stringa vuota", () => {
  const rotta: RispostaGrounded = {
    candidates: [{ groundingMetadata: { groundingChunks: [{ web: {} }, { }, { web: { uri: "" } }] } }],
  };
  assert.deepEqual(urlDalleCitazioni(rotta), []);
});

// ----- Le interrogazioni -------------------------------------------

test("ricerca: quattro interrogazioni al massimo, e coprono le quattro piattaforme", () => {
  const q = queryPerLead({
    nome: "Trattoria di Prova", citta: "Bari", indirizzo: "Via Sparano 10",
    telefono: "+39 080 555 0101", categoria: "Ristorante",
  });
  assert.equal(q.length, MAX_QUERY_PER_LEAD);
  assert.ok(q.some((x) => /Instagram/i.test(x)));
  assert.ok(q.some((x) => /Facebook/i.test(x)));
  assert.ok(q.some((x) => /TikTok/i.test(x)));
});

test("ricerca: l'ancora della seconda interrogazione e l'indirizzo o il telefono", () => {
  // Nome piu citta trova gli omonimi. Nome piu indirizzo no: e per
  // quello che la seconda interrogazione esiste.
  const q = queryPerLead({
    nome: "Bar Centrale", citta: "Bari", indirizzo: "Via Sparano 10",
    telefono: "", categoria: "",
  });
  assert.ok(q.some((x) => x.includes("Via Sparano 10")), `nessuna ancora forte: ${q.join(" | ")}`);
});

// ----- Senza chiave: si dichiara, non si rompe ---------------------

test("ricerca: senza chiave Gemini si dichiara, e non parte nessuna interrogazione", async () => {
  // Il collector deve arrivare in fondo lo stesso. Una scoperta social
  // mancata e una lacuna dichiarata, non un guasto: se facesse fallire
  // la raccolta, un'attivita senza sito non produrrebbe mai un dossier.
  const r = await scopriProfili({
    nome: "Trattoria di Prova", citta: "Bari", indirizzo: "", telefono: "", categoria: "",
  });
  assert.equal(r.esito, "not_configured", `esito ${r.esito}: ${r.detail}`);
  assert.equal(r.queries_used, 0, "senza chiave non si spende niente");
  assert.equal(r.tokens, 0);
  assert.deepEqual(r.candidati, []);
});

test("ricerca: senza nome non si cerca nulla", async () => {
  // L'esito dipende da che cosa manca per primo — la chiave qui non
  // c'e, quindi si dichiara quella. Cio che il test deve garantire e
  // che in nessuno dei due casi parta un'interrogazione: cercare
  // «profilo ufficiale di» senza un nome restituirebbe il primo bar
  // capitato.
  const r = await scopriProfili({ nome: "  ", citta: "Bari", indirizzo: "", telefono: "", categoria: "" });
  assert.ok(r.esito === "no_results" || r.esito === "not_configured", `esito ${r.esito}`);
  assert.equal(r.queries_used, 0);
  assert.deepEqual(r.candidati, []);
});

test("ricerca: il tetto di quattro interrogazioni non si puo alzare dall'esterno", async () => {
  const q = queryPerLead({
    nome: "X", citta: "Bari", indirizzo: "Via Y", telefono: "1", categoria: "Bar",
  });
  assert.ok(q.length <= MAX_QUERY_PER_LEAD);
  // Anche chiedendone di piu, il tetto e nel modulo e non nel chiamante.
  const r = await scopriProfili(
    { nome: "X", citta: "Bari", indirizzo: "", telefono: "", categoria: "" },
    { maxQuery: 99 },
  );
  assert.ok(r.queries_used <= MAX_QUERY_PER_LEAD);
});

// ----- I reindirizzamenti del grounding ---------------------------

test("ricerca: un URL normale non viene toccato, e non costa una richiesta", async () => {
  const u = "https://www.instagram.com/trattoriadiprova";
  assert.equal(await risolvi(u), u);
});

test("ricerca: la risoluzione non e un varco per la rete interna", async () => {
  // Un reindirizzamento e pur sempre un indirizzo scelto da qualcun
  // altro: passa dalla guardia SSRF come qualunque URL esterno.
  for (const u of [
    "http://169.254.169.254/vertexaisearch/grounding-api-redirect/x",
    "http://127.0.0.1:8080/grounding-api-redirect/x",
    "http://[::1]/grounding-api-redirect/x",
  ]) {
    assert.equal(await risolvi(u), "", `indirizzo interno non fermato: ${u}`);
  }
});

// ----- Dove si e fermata --------------------------------------------

test("ricerca: i conteggi dicono DOVE si e fermata, non solo che si e fermata", async () => {
  // Il primo rilancio reale ha risposto `no_results` con quattro query e
  // 3206 token spesi. Da quell'esito solo non si poteva dire se la
  // ricerca non avesse citato niente, se le citazioni non fossero
  // profili, o se i reindirizzamenti non si fossero risolti — tre guasti
  // con tre rimedi diversi, appiattiti su una parola sola.
  const r = await scopriProfili({
    nome: "Trattoria di Prova", citta: "Bari", indirizzo: "", telefono: "", categoria: "",
  });
  assert.ok(r.conteggi, "i conteggi ci devono essere anche quando non si cerca");
  assert.equal(r.conteggi.citazioni, 0);
  assert.equal(r.conteggi.risolti, 0);
  assert.equal(r.conteggi.profili, 0);
  assert.equal(r.conteggi.unici, 0);
});
