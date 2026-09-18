// L'ambiente PRIMA di tutto: vedi _ambiente-rotte.ts per il perche.
import { SEGRETO_CRON } from "./_ambiente-rotte";

import assert from "node:assert/strict";
import { test } from "node:test";

import { POST as analizza, GET as analizzaGet } from "../../app/api/demo/analizza/route";
import { POST as approva, GET as approvaGet } from "../../app/api/demo/approva/route";
import { GET as proposta } from "../../app/api/demo/proposta/route";

// ============================================================
// I cancelli delle rotte che spendono e che pubblicano.
//
// Nessuna sessione, in questi test: e proprio il punto. Cio che si
// verifica e che SENZA una persona autenticata non si arriva mai al
// codice che scarica immagini o scrive una pagina — e che nemmeno il
// bearer del cron ci arriva, perche queste due decisioni le prende
// qualcuno guardando una schermata.
// ============================================================

const origine = "https://specter.example";

const post = (url: string, corpo: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "specter.example",
      "x-forwarded-proto": "https",
      origin: origine,
      ...headers,
    },
    body: JSON.stringify(corpo),
  });

test("rotte: GET non e ammesso dove si spende o si pubblica", async () => {
  assert.equal((await analizzaGet()).status, 405);
  assert.equal((await approvaGet()).status, 405);
});

test("rotte: senza Content-Type JSON si risponde 415", async () => {
  // Un form HTML puo inviare solo form-urlencoded, multipart o
  // text/plain: pretendere JSON esclude il form cross-site.
  const req = new Request("https://specter.example/api/demo/analizza", {
    method: "POST",
    headers: { "content-type": "text/plain", host: "specter.example", origin: origine },
    body: "{}",
  });
  assert.equal((await analizza(req)).status, 415);
});

test("rotte: un'Origine esterna viene rifiutata", async () => {
  const req = post("https://specter.example/api/demo/approva", {}, { origin: "https://cattivo.example" });
  assert.equal((await approva(req)).status, 403);
});

test("rotte: senza Origin — cioe non da una pagina — si rifiuta", async () => {
  const req = new Request("https://specter.example/api/demo/analizza", {
    method: "POST",
    headers: { "content-type": "application/json", host: "specter.example" },
    body: "{}",
  });
  assert.equal((await analizza(req)).status, 403);
});

test("rotte: il bearer del cron NON apre queste due", async () => {
  // Il cron passa da un'altra porta e su un elenco chiuso di rotte.
  // Qui si dice esplicitamente di no invece di lasciarlo dedurre
  // dall'assenza di sessione: se un giorno qualcuno aggiungesse queste
  // rotte a CRON_PATHS, il rifiuto resterebbe.
  const auth = { authorization: `Bearer ${SEGRETO_CRON}` };
  for (const [nome, h] of [["analizza", analizza], ["approva", approva]] as const) {
    const r = await h(post(`https://specter.example/api/demo/${nome}`, {}, auth));
    assert.equal(r.status, 401, nome);
    const j = await r.json();
    assert.match(String(j.error), /sessione operatore/, nome);
  }
});

test("rotte: senza sessione si risponde 401 e non si tocca niente", async () => {
  for (const [nome, h] of [["analizza", analizza], ["approva", approva]] as const) {
    const r = await h(post(`https://specter.example/api/demo/${nome}`, { project_id: "x" }));
    assert.equal(r.status, 401, nome);
  }
  const g = await proposta(new Request("https://specter.example/api/demo/proposta?lead_id=x"));
  assert.equal(g.status, 401);
});
