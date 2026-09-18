import type { FotoDemo } from "./foto";

// ============================================================
// La curatela fotografica: quali fotografie vanno in pagina, e con
// che peso.
//
// PERCHE NON LA DECIDE IL CODICE.
//
// `display_allowed` vuol dire «legalmente mostrabile», non
// «esteticamente utile». Le due cose non coincidono quasi mai: fra
// dieci fotografie di Google Maps ce ne sono di ottime, di neutre e
// alcune che abbassano la percezione del centro — un magazzino, un
// ambiente vuoto, un'attrezzatura tagliata a meta.
//
// Il collector puo misurare i pixel: dimensioni, proporzione, nitidezza
// stimata. Non puo sapere COSA c'e dentro. `probable_role` e `unknown`
// su tutte e dieci, e `quality_score` e una funzione delle dimensioni,
// non del soggetto. Un punteggio di 100 su una foto di scatoloni resta
// 100.
//
// Quindi la curatela e un atto di chi guarda, come l'approvazione dei
// diritti: si registra per fotografia, e la pagina la rispetta. Il
// codice fa una cosa sola — comporre bene cio che e stato scelto.
// ============================================================

export type RuoloDemo = "keep" | "secondary" | "exclude";

/** Il verdetto per una fotografia, piu la nota di chi l'ha guardata. */
export interface Curatela {
  ruolo: RuoloDemo;
  /** Cosa mostra davvero. Scritto da chi vede, mai dedotto. */
  soggetto: string;
}

/** Senza verdetto una fotografia NON e in pagina.
 *
 *  Il default e escludere, non includere: e la scelta prudente quando
 *  nessuno ha ancora guardato. Una demo con sei fotografie scelte vale
 *  piu di una con dieci fotografie a caso, e mostrare per difetto
 *  significa pubblicare il magazzino finche qualcuno non se ne accorge. */
export const RUOLO_PREDEFINITO: RuoloDemo = "exclude";

export interface FotoCurata extends FotoDemo {
  ruolo: RuoloDemo;
  soggetto: string;
}

export function applicaCuratela(
  foto: readonly FotoDemo[],
  curatela: Readonly<Record<string, Curatela>>,
): FotoCurata[] {
  return foto.map((f) => {
    const c = curatela[f.id];
    return { ...f, ruolo: c?.ruolo ?? RUOLO_PREDEFINITO, soggetto: c?.soggetto ?? "" };
  });
}

/**
 * La sequenza editoriale.
 *
 * Non una griglia: una dominante, una coppia, una isolata. E il ritmo
 * che un servizio fotografico ha e che un contact sheet non ha — e
 * regge anche quando le fotografie sono cinque invece di dieci, che e
 * il caso normale dopo una curatela onesta.
 *
 * `keep` porta i posti forti in ordine: prima la dominante, poi la
 * chiusura, poi la coppia. `secondary` riempie solo cio che resta.
 */
export interface Sequenza {
  /** La fotografia della hero: la migliore, con massa vera. */
  apertura: FotoCurata | null;
  /** Il primo piano che racconta il gesto. */
  momento: FotoCurata | null;
  /** Due fotografie affiancate: gli ambienti. */
  coppia: FotoCurata[];
  /** L'ultima, larga, sopra la chiamata all'azione. */
  chiusura: FotoCurata | null;
  /** Escluse dalla pagina, non dal dossier. */
  escluse: FotoCurata[];
}

/** Al massimo cinque fotografie in pagina: una dominante, un momento,
 *  una coppia, una chiusura. Oltre, tornano a essere un mosaico. */
export const MAX_IN_PAGINA = 5;

export function sequenza(foto: readonly FotoCurata[]): Sequenza {
  const escluse = foto.filter((f) => f.ruolo === "exclude");
  // `keep` prima, nell'ordine in cui stanno nel manifest: chi ha
  // guardato le ha gia ordinate implicitamente scegliendole.
  const forti = foto.filter((f) => f.ruolo === "keep");
  const deboli = foto.filter((f) => f.ruolo === "secondary");
  const coda = forti.concat(deboli).slice(0, MAX_IN_PAGINA);

  const prendi = () => coda.shift() ?? null;
  const apertura = prendi();
  const momento = prendi();
  const coppia: FotoCurata[] = [];
  for (let i = 0; i < 2; i++) { const f = prendi(); if (f) coppia.push(f); }
  const chiusura = prendi();

  return { apertura, momento, coppia, chiusura, escluse };
}

/** Le fotografie davvero in pagina, in ordine. Serve a contarle e a
 *  costruire l'elenco delle attribuzioni senza ripetere la logica. */
export function inPagina(s: Sequenza): FotoCurata[] {
  return [s.apertura, s.momento, ...s.coppia, s.chiusura]
    .filter((f): f is FotoCurata => f !== null);
}
