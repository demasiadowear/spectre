// ============================================================
// Le versioni delle tre parti che decidono, e perche stanno qui.
//
// L'idempotenza dell'analisi era legata al solo `manifest_revision`:
// stesse fotografie, stessa proposta, nessuna nuova spesa. Giusto
// finche l'unica cosa che cambia sono le fotografie — ma fra una corsa
// e l'altra e cambiato TRE VOLTE l'algoritmo, e con il manifest fermo
// il sistema avrebbe restituito il risultato vecchio dicendo
// «invariata». Cioe: correggo il compositore, e il lead continua a
// vedere la proposta sbagliata.
//
// Quindi la chiave dell'idempotenza non e solo «quali fotografie»: e
// «quali fotografie, guardate come, da quale compositore».
//
// Stanno in un modulo loro perche le legge anche la persistenza, che
// non deve tirarsi dentro l'SDK di Gemini per tre stringhe.
//
// QUANDO SI ALZANO:
//   analyzer_version  cambia cosa si CHIEDE al modello (schema, campi)
//   prompt_version    cambia come glielo si chiede (istruzioni)
//   composer_version  cambia come si DECIDE a partire dalle risposte
// ============================================================

/** Lo schema della risposta: quali campi si chiedono al modello.
 *  a4 = tredici generi in tre fasce: chi puo aprire, chi sta solo in
 *  galleria, chi non entra. */
export const ANALYZER_VERSION = "a4";

/** Le istruzioni. p4 = niente `usable`, niente `role`: solo
 *  caratteristiche osservabili, e la scena distinta dal dettaglio. */
export const PROMPT_VERSION = "p4";

/** Il compositore deterministico. c5 = valuta tutti i candidati
 *  scaricati, esclude solo per cause esplicite, e l'apertura si
 *  guadagna con prove positive e un genere della prima fascia. c5: il
 *  marchio in apertura si valuta per QUALE e, non per il fatto che c'e. */
export const COMPOSER_VERSION = "c5";

export interface Versioni {
  analyzer_version: string;
  prompt_version: string;
  composer_version: string;
}

export const VERSIONI_CORRENTI: Versioni = {
  analyzer_version: ANALYZER_VERSION,
  prompt_version: PROMPT_VERSION,
  composer_version: COMPOSER_VERSION,
};

/** Le versioni con cui e stata prodotta una proposta sono ancora
 *  quelle di adesso? Se no, la proposta va rifatta anche se le
 *  fotografie sono identiche. */
export function versioniAttuali(v: Partial<Versioni> | null | undefined): boolean {
  if (!v) return false;
  return v.analyzer_version === ANALYZER_VERSION
    && v.prompt_version === PROMPT_VERSION
    && v.composer_version === COMPOSER_VERSION;
}
