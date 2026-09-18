// ============================================================
// Le variabili PRIMA degli import delle rotte.
//
// `lib/auth.ts` e `lib/turso.ts` leggono l'ambiente al momento
// dell'import: impostarle dentro il test significherebbe impostarle
// dopo, e il test girerebbe su una configurazione diversa da quella che
// dichiara di provare.
// ============================================================

process.env.SPECTRE_PASSWORD ??= "prova-locale";
process.env.NEXTAUTH_SECRET ??= "prova-locale";
process.env.CRON_SECRET ??= "segreto-del-cron";

export const SEGRETO_CRON = process.env.CRON_SECRET;
