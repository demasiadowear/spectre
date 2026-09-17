import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ============================================================
// Ambiente del test end-to-end, impostato PRIMA di ogni altro import.
//
// `lib/turso.ts` costruisce il client al momento dell'import, leggendo
// `TURSO_DATABASE_URL`: se le variabili venissero impostate dentro il
// test, il client sarebbe gia stato costruito a null e il test
// girerebbe su un database inesistente passando lo stesso — il tipo di
// test che conferma qualunque cosa.
//
// Sta in un modulo separato perche gli import di un modulo vengono
// valutati nell'ordine in cui compaiono: importare questo per primo e
// l'unico modo di avere le variabili pronte in tempo.
// ============================================================

export const DIR_E2E = mkdtempSync(join(tmpdir(), "spectre-e2e-"));

process.env.TURSO_DATABASE_URL = `file:${join(DIR_E2E, "prova.db")}`;
// Un database su file non autentica, ma `isTursoConfigured` vuole
// entrambe le variabili: qui il token e un segnaposto dichiarato.
process.env.TURSO_AUTH_TOKEN = "locale-non-usato";
process.env.SPECTRE_PASSWORD = "prova-locale";
process.env.NEXTAUTH_SECRET = "prova-locale";
delete process.env.FACTORY_PAUSED;
