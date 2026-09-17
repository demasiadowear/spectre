import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authState, corpo503, scopeDi, segretoDiFirma, suVercel,
  ENV_ALLOW_DEV, ENV_AUTH_PASSWORD, ENV_AUTH_SECRET,
} from "../../lib/auth-mode";
import { capabilities } from "../../lib/collector/capability";
import type { DiagnosiDatabase } from "../../lib/collector/diagnostica";

// ============================================================
// La regola precedente era `AUTH_DISABLED = !SPECTRE_PASSWORD`: senza
// password l'applicazione girava APERTA, ovunque, Vercel compreso.
// Questi test esistono perche quel difetto non torni, e perche il
// `default` della decisione resti «chiuso».
//
// Il caso che conta e l'ultimo di ogni gruppo: non «si apre quando
// deve», ma «NON si apre quando non deve».
// ============================================================

const env = (o: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  o as unknown as NodeJS.ProcessEnv;

// ----- I quattro casi obbligatori --------------------------------

test("fail-closed: VERCEL=1 e segreto assente -> accesso negato", () => {
  const s = authState(env({ VERCEL: "1" }));
  assert.equal(s.mode, "not_configured");
  assert.equal(s.open, false, "su Vercel senza segreti NON si apre");
  assert.match(s.reason, /Vercel/);
  assert.deepEqual(s.missing.sort(), [ENV_AUTH_SECRET, ENV_AUTH_PASSWORD].sort());
});

test("fail-closed: NODE_ENV=production e segreto assente -> accesso negato", () => {
  const s = authState(env({ NODE_ENV: "production" }));
  assert.equal(s.mode, "not_configured");
  assert.equal(s.open, false);
  assert.match(s.reason, /production/);
});

test("fail-closed: locale senza ALLOW_DEV_NO_AUTH=1 -> accesso negato", () => {
  const s = authState(env({ NODE_ENV: "development" }));
  assert.equal(s.mode, "not_configured");
  assert.equal(s.open, false, "l'assenza della password non e piu un permesso");
  assert.match(s.reason, new RegExp(ENV_ALLOW_DEV));
});

test("consentito: locale con ALLOW_DEV_NO_AUTH=1 -> modalita sviluppo", () => {
  const s = authState(env({ NODE_ENV: "development", ALLOW_DEV_NO_AUTH: "1" }));
  assert.equal(s.mode, "dev_open");
  assert.equal(s.open, true);
});

// ----- I modi di aggirare la regola, chiusi uno per uno ----------

test("fail-closed: ALLOW_DEV_NO_AUTH=1 NON apre su Vercel", () => {
  for (const e of [
    { VERCEL: "1", ALLOW_DEV_NO_AUTH: "1" },
    { VERCEL_ENV: "preview", ALLOW_DEV_NO_AUTH: "1" },
    { VERCEL_URL: "x.vercel.app", ALLOW_DEV_NO_AUTH: "1" },
    { NEXT_PUBLIC_VERCEL_ENV: "preview", ALLOW_DEV_NO_AUTH: "1" },
  ]) {
    const s = authState(env(e));
    assert.equal(s.mode, "not_configured", `${JSON.stringify(e)} non deve aprire`);
  }
});

test("fail-closed: ALLOW_DEV_NO_AUTH=1 NON apre in produzione", () => {
  const s = authState(env({ NODE_ENV: "production", ALLOW_DEV_NO_AUTH: "1" }));
  assert.equal(s.mode, "not_configured");
});

test("fail-closed: solo il valore esatto \"1\" e un'opt-in", () => {
  for (const v of ["true", "yes", "0", "", " ", "on", "TRUE"]) {
    const s = authState(env({ NODE_ENV: "development", ALLOW_DEV_NO_AUTH: v }));
    assert.equal(s.mode, "not_configured", `ALLOW_DEV_NO_AUTH=${JSON.stringify(v)} non deve aprire`);
  }
});

test("password senza NEXTAUTH_SECRET: resta chiusa, col segreto derivato", () => {
  // Il difetto era un ripiego FISSO scritto in un repository pubblico:
  // chi lo leggeva poteva firmarsi un token valido. Il problema era che
  // fosse pubblico, non che esistesse.
  //
  // Ora il segreto si deriva dalla password, che e configurata e non e
  // pubblica: l'autenticazione resta in vigore, nessuno forgia niente,
  // e un'installazione che HA una password non cade per una variabile
  // assente. Il pannello continua a dichiararla mancante.
  const e = env({ VERCEL: "1", SPECTRE_PASSWORD: "password-vera" });
  const s = authState(e);
  assert.equal(s.mode, "enforced", "l'autenticazione resta obbligatoria");
  assert.equal(s.open, false, "non si apre mai");
  assert.equal(s.segreto_derivato, true);
  assert.deepEqual(s.missing, [ENV_AUTH_SECRET], "e comunque dichiarata mancante");

  const chiave = segretoDiFirma(e);
  assert.ok(chiave.length > 0, "un segreto di firma deve esserci");
  assert.notEqual(chiave, "spectre-dev-secret-not-for-production",
    "mai piu la costante pubblica");
  assert.notEqual(chiave, "password-vera", "e mai la password nuda");
  assert.ok(chiave.startsWith("spectre-firma-v1:"), "etichettata, quindi non riusabile altrove");
});

test("il segreto esplicito ha sempre la precedenza sulla derivazione", () => {
  const chiave = segretoDiFirma(env({ SPECTRE_PASSWORD: "p", NEXTAUTH_SECRET: "segreto-esplicito" }));
  assert.equal(chiave, "segreto-esplicito");
});

test("senza password non esiste nessun segreto di firma", () => {
  assert.equal(segretoDiFirma(env({ VERCEL: "1" })), "",
    "in not_configured non si firma niente, e nessuna richiesta ci arriva");
});

test("fail-closed: il segreto di firma da solo non basta", () => {
  const s = authState(env({ VERCEL: "1", NEXTAUTH_SECRET: "x" }));
  assert.equal(s.mode, "not_configured");
  assert.deepEqual(s.missing, [ENV_AUTH_PASSWORD]);
});

test("fail-closed: valori di soli spazi non contano come configurati", () => {
  const s = authState(env({ VERCEL: "1", SPECTRE_PASSWORD: "   ", NEXTAUTH_SECRET: "\t" }));
  assert.equal(s.mode, "not_configured");
  assert.equal(s.missing.length, 2);
  assert.equal(segretoDiFirma(env({ SPECTRE_PASSWORD: "   " })), "",
    "una password di soli spazi non genera un segreto");
});

test("enforced: con entrambi i segreti la sessione e obbligatoria, ovunque", () => {
  for (const e of [
    { VERCEL: "1", SPECTRE_PASSWORD: "p", NEXTAUTH_SECRET: "s" },
    { NODE_ENV: "production", SPECTRE_PASSWORD: "p", NEXTAUTH_SECRET: "s" },
    { NODE_ENV: "development", SPECTRE_PASSWORD: "p", NEXTAUTH_SECRET: "s" },
    // Nemmeno l'opt-in di sviluppo scavalca dei segreti presenti.
    { ALLOW_DEV_NO_AUTH: "1", SPECTRE_PASSWORD: "p", NEXTAUTH_SECRET: "s" },
  ]) {
    const s = authState(env(e));
    assert.equal(s.mode, "enforced", `${JSON.stringify(e)} deve essere enforced`);
    assert.equal(s.open, false);
  }
});

// ----- Come si presenta la chiusura ------------------------------

test("il 503 dice cosa manca per nome e non contiene nessun valore", () => {
  const s = authState(env({ VERCEL_ENV: "preview" }));
  const c = corpo503(s);
  assert.equal(c.error, "authentication_not_configured");
  assert.deepEqual(c.missing.sort(), [ENV_AUTH_PASSWORD, ENV_AUTH_SECRET].sort());
  assert.equal(c.scope, "vercel:preview");

  // E con dei valori presenti, nessun frammento ne esce.
  const conValori = corpo503(authState(env({
    VERCEL_ENV: "preview", ALLOW_DEV_NO_AUTH: "1",
  })));
  const testo = JSON.stringify(conValori) + JSON.stringify(c);
  assert.ok(!testo.includes("password"), "nessun valore nel corpo");
  assert.ok(!/[0-9]{6,}/.test(testo), "nessuna lunghezza o cifra sospetta");
});

test("lo scope distingue Preview da Production: e li che si sbaglia", () => {
  assert.equal(scopeDi(env({ VERCEL_ENV: "preview" })), "vercel:preview");
  assert.equal(scopeDi(env({ VERCEL_ENV: "production" })), "vercel:production");
  assert.equal(scopeDi(env({ VERCEL: "1" })), "vercel");
  assert.equal(scopeDi(env({ NODE_ENV: "production" })), "produzione");
  assert.equal(scopeDi(env({})), "locale");
});

test("Vercel si riconosce da piu di una variabile", () => {
  assert.equal(suVercel(env({ VERCEL: "1" })), true);
  assert.equal(suVercel(env({ VERCEL_ENV: "preview" })), true);
  assert.equal(suVercel(env({ VERCEL_URL: "x.vercel.app" })), true);
  assert.equal(suVercel(env({})), false);
});

// ----- Il pannello capacita --------------------------------------

const diagnosi = (stato: DiagnosiDatabase["stato"]): DiagnosiDatabase => ({
  stato, detail: "", missing: [], tabelle_mancanti: [], lead: 0, ms: 0,
});

test("capability: sette booleani, e nessun segreto", () => {
  const c = capabilities(
    env({
      VERCEL_ENV: "preview",
      SPECTRE_PASSWORD: "p-segreta", NEXTAUTH_SECRET: "s-segreta",
      GOOGLE_PLACES_API_KEY: "g-segreta",
      TURSO_DATABASE_URL: "libsql://x", TURSO_AUTH_TOKEN: "t-segreta",
    }),
    diagnosi("database_ready"),
  );

  assert.equal(c.authentication_configured, true);
  assert.equal(c.database_configured, true);
  assert.equal(c.database_reachable, true);
  assert.equal(c.database_schema_present, true);
  assert.equal(c.google_places_configured, true);
  assert.equal(c.storage_configured, false);
  assert.equal(c.browser_worker_configured, false);

  const testo = JSON.stringify(c);
  for (const frammento of ["p-segreta", "s-segreta", "g-segreta", "t-segreta", "segreta", "libsql"]) {
    assert.ok(!testo.includes(frammento), `«${frammento}» e uscito nella risposta`);
  }
});

test("capability: configurato, raggiungibile e schema sono tre cose diverse", () => {
  const base = env({
    SPECTRE_PASSWORD: "p", NEXTAUTH_SECRET: "s",
    TURSO_DATABASE_URL: "libsql://x", TURSO_AUTH_TOKEN: "t",
  });

  const irraggiungibile = capabilities(base, diagnosi("database_unreachable"));
  assert.equal(irraggiungibile.database_configured, true, "le variabili ci sono");
  assert.equal(irraggiungibile.database_reachable, false, "ma l'host non risponde");
  assert.equal(irraggiungibile.database_schema_present, false);

  const senzaSchema = capabilities(base, diagnosi("database_schema_missing"));
  assert.equal(senzaSchema.database_reachable, true, "connesso");
  assert.equal(senzaSchema.database_schema_present, false, "ma senza tabelle");

  const vuoto = capabilities(base, diagnosi("database_empty"));
  assert.equal(vuoto.database_reachable, true);
  assert.equal(vuoto.database_schema_present, true, "vuoto non vuol dire senza schema");
});

test("capability: senza diagnosi non si dichiara raggiungibile", () => {
  const c = capabilities(env({ TURSO_DATABASE_URL: "x", TURSO_AUTH_TOKEN: "y" }));
  assert.equal(c.database_configured, true);
  assert.equal(c.database_reachable, false, "non averlo chiesto non e una risposta affermativa");
});

test("capability: dev_open e not_configured non sono «autenticazione configurata»", () => {
  const aperto = capabilities(env({ NODE_ENV: "development", ALLOW_DEV_NO_AUTH: "1" }));
  assert.equal(aperto.authentication_configured, false, "aperta per scelta non e protetta");

  const rotto = capabilities(env({ VERCEL: "1" }));
  assert.equal(rotto.authentication_configured, false);
  assert.ok(rotto.missing.some((m) => m.name === ENV_AUTH_PASSWORD));
  assert.ok(rotto.missing.some((m) => m.name === ENV_AUTH_SECRET));
  assert.equal(rotto.missing[0].scope, "vercel");
});
