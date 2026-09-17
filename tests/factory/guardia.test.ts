import assert from "node:assert/strict";
import { test } from "node:test";
import { guardiaRichiesta } from "../../lib/guardia-richiesta";

// ============================================================
// La sessione dice CHI sei, non chi ha scritto la richiesta.
//
// Un sito ostile aperto nella stessa finestra puo far partire una POST
// verso Specter usando i cookie dell'operatore: la sessione e valida,
// la richiesta no. Questi test fissano i quattro controlli che lo
// impediscono, e soprattutto i casi in cui NON devono lasciar passare.
// ============================================================

const ORIGINE = "https://specter-ecru.vercel.app";

function richiesta(o: {
  metodo?: string; origin?: string | null; tipo?: string | null; host?: string;
} = {}): Request {
  const h: Record<string, string> = {};
  if (o.tipo !== null) h["content-type"] = o.tipo ?? "application/json";
  if (o.origin !== null && o.origin !== undefined) h["origin"] = o.origin;
  h["host"] = o.host ?? "specter-ecru.vercel.app";
  const metodo = o.metodo ?? "POST";
  return new Request("https://specter-ecru.vercel.app/api/collector/run", {
    method: metodo,
    headers: h,
    body: metodo === "GET" || metodo === "HEAD" ? undefined : "{}",
  });
}

const env = {} as NodeJS.ProcessEnv;

test("csrf: POST same-origin con JSON e ammessa", () => {
  const g = guardiaRichiesta(richiesta({ origin: ORIGINE }), { env });
  assert.equal(g.ok, true, g.ok ? "" : g.error);
});

test("csrf: POST cross-origin viene rifiutata con 403", () => {
  for (const o of [
    "https://sito-ostile.example",
    "https://specter-ecru.vercel.app.ostile.example",
    "http://specter-ecru.vercel.app",   // stesso host, ma via http
    "null",
  ]) {
    const g = guardiaRichiesta(richiesta({ origin: o }), { env });
    assert.equal(g.ok, false, `${o} doveva essere rifiutata`);
    if (!g.ok) assert.equal(g.status, 403, `${o}: stato ${g.status}`);
  }
});

test("csrf: un Origin che somiglia all'host non basta", () => {
  // «specter-ecru.vercel.app.ostile.example» contiene il nostro host
  // come prefisso: un confronto per sottostringa lo lascerebbe passare.
  const g = guardiaRichiesta(
    richiesta({ origin: "https://specter-ecru.vercel.app.ostile.example" }), { env },
  );
  assert.equal(g.ok, false);
});

test("csrf: senza Origin la rotta di browser nega", () => {
  const g = guardiaRichiesta(richiesta({ origin: null }), { env });
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.status, 403);
    assert.match(g.error, /senza Origin/);
  }
});

test("csrf: senza Origin un client non-browser puo essere ammesso", () => {
  // E il caso del cron, che si autentica col bearer e non manda Origin.
  const g = guardiaRichiesta(richiesta({ origin: null }), { env, richiediOrigin: false });
  assert.equal(g.ok, true, g.ok ? "" : g.error);
});

test("csrf: GET su una rotta mutativa risponde 405", () => {
  const g = guardiaRichiesta(richiesta({ metodo: "GET", origin: ORIGINE }), { env });
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.status, 405);
});

test("csrf: nemmeno HEAD, PUT o DELETE passano dove e ammessa solo POST", () => {
  for (const m of ["HEAD", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const g = guardiaRichiesta(richiesta({ metodo: m, origin: ORIGINE }), { env });
    assert.equal(g.ok, false, `${m} doveva essere rifiutato`);
    if (!g.ok) assert.equal(g.status, 405);
  }
});

test("csrf: i Content-Type che un form puo inviare sono rifiutati", () => {
  // Un form HTML cross-site puo mandare solo questi tre, e non puo
  // impostarne altri senza preflight: pretendere JSON esclude il
  // vettore classico.
  for (const t of [
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "text/plain",
    null,
  ]) {
    const g = guardiaRichiesta(richiesta({ origin: ORIGINE, tipo: t }), { env });
    assert.equal(g.ok, false, `${t} doveva essere rifiutato`);
    if (!g.ok) assert.equal(g.status, 415);
  }
});

test("csrf: il Content-Type con charset resta valido", () => {
  const g = guardiaRichiesta(
    richiesta({ origin: ORIGINE, tipo: "application/json; charset=utf-8" }), { env },
  );
  assert.equal(g.ok, true, g.ok ? "" : g.error);
});

test("csrf: il metodo si controlla PRIMA del resto", () => {
  // Una GET non deve arrivare a farsi leggere il corpo nemmeno se il
  // Content-Type e sbagliato: prima 405, poi tutto il resto.
  const g = guardiaRichiesta(richiesta({ metodo: "GET", origin: null, tipo: null }), { env });
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.status, 405, "il metodo viene prima");
});

test("csrf: un host dichiarato nelle env e ammesso", () => {
  const g = guardiaRichiesta(
    richiesta({ origin: "https://specter.ayromex.com", host: "altro.vercel.app" }),
    { env: { NEXTAUTH_URL: "https://specter.ayromex.com" } as NodeJS.ProcessEnv },
  );
  assert.equal(g.ok, true, g.ok ? "" : g.error);
});

test("csrf: il messaggio d'errore non rimanda indietro l'Origin ricevuto", () => {
  // Riflettere input di terzi dentro una risposta e un modo di farsi
  // usare come veicolo.
  const ostile = "https://<script>alert(1)</script>.example";
  const g = guardiaRichiesta(richiesta({ origin: ostile }), { env });
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.ok(!g.error.includes("script"), "l'Origin e finito nel messaggio");
    assert.ok(!g.error.includes(ostile));
  }
});
