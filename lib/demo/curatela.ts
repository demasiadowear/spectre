import type { FotoDemo } from "./foto";

// ============================================================
// La curatela fotografica: quali fotografie vanno in pagina, in che
// ordine e con quale ritaglio.
//
// GLI STATI, E PERCHE IL DEFAULT NON E «ESCLUDI».
//
// Avevo scritto `exclude` come stato predefinito, ragionando che
// mostrare per difetto significa pubblicare il magazzino. Era sbagliato
// nel nome: `exclude` e un GIUDIZIO, e un giudizio su una fotografia
// che nessuno — nessuna persona e nessun modello — ha mai guardato non
// esiste. Dire «esclusa» di un'immagine mai vista e la stessa specie
// di errore che dire «non ha social» di un profilo mai aperto.
//
//   unreviewed    nessuno ha ancora osservato i byte
//   selected      va in pagina
//   not_selected  non va in pagina, in QUESTO progetto
//   needs_review  la decisione richiede una persona
//
// E per le fotografie di Places `selected` / `not_selected` sono
// decisioni DEL PROGETTO, non classificazioni permanenti
// dell'immagine: la stessa fotografia puo entrare in un progetto e
// restare fuori dal successivo senza che nessuna verita cambi.
// ============================================================

export type StatoCuratela = "unreviewed" | "selected" | "not_selected" | "needs_review";

/** Il ruolo di impaginazione. E una decisione di layout, non una
 *  descrizione di cosa mostra la fotografia. */
export type RuoloLayout = "hero" | "treatment" | "interior" | "detail" | "closing";

/**
 * Cio che si conserva di una fotografia scelta.
 *
 * Solo impaginazione: indice, ordine, ruolo, ritaglio. Nessuna
 * descrizione, nessun punteggio, nessuna motivazione — vedi
 * lib/demo/policy-media.ts e la nota sul regime Places.
 *
 * Manca di proposito il PERCHE. Sembra una perdita, ed e la riga che
 * tiene separata una decisione di impaginazione da un indice di
 * contenuti derivato da immagini altrui.
 */
export interface SceltaFoto {
  /** Indice nel MediaManifest: l'unico nome stabile. */
  indice: number;
  /** Posizione in pagina, da 0. */
  ordine: number;
  ruolo: RuoloLayout;
  /** `object-position` da applicare, es. "50% 28%". */
  object_position: string;
  stato: StatoCuratela;
}

/** La curatela di un progetto: cosa e stato scelto, e cosa aspetta una
 *  persona. Vive nel progetto, non nel dossier. */
export interface CuratelaProgetto {
  scelte: SceltaFoto[];
  /** Indici che richiedono una decisione umana, con il motivo in una
   *  parola NON derivata dall'immagine. */
  da_rivedere: { indice: number; motivo: MotivoRevisione }[];
  /** Quando e stata composta. Serve a sapere se e vecchia. */
  composta_il: string;
  /** Firma del manifest su cui e stata composta: se il manifest
   *  cambia, la curatela non e piu valida per quelle fotografie. */
  firma_manifest: string;
}

/** Perche serve una persona. Insieme chiuso, e nessuna voce descrive
 *  il CONTENUTO: sono stati della decisione, non dell'immagine. */
export type MotivoRevisione =
  | "bassa_confidenza"
  | "possibile_persona_identificabile"
  | "possibile_marchio"
  | "analisi_non_disponibile";

export const RITAGLIO_PREDEFINITO = "50% 50%";

/** Al massimo cinque: oltre, una sequenza torna a essere un mosaico.
 *  Non si riempie per arrivare al numero. */
export const MAX_IN_PAGINA = 5;

/** L'ordine dei ruoli in pagina. La sequenza editoriale e questa, e
 *  non cambia con il numero di fotografie disponibili: con tre foto si
 *  usano i primi tre ruoli, non si inventa una griglia. */
export const SEQUENZA_RUOLI: readonly RuoloLayout[] = [
  "hero", "treatment", "interior", "detail", "closing",
];

export interface FotoInPagina extends FotoDemo {
  ruolo: RuoloLayout;
  object_position: string;
}

/** Applica una curatela alle fotografie mostrabili, in ordine. */
export function applicaCuratela(
  foto: readonly FotoDemo[],
  c: CuratelaProgetto | null,
): FotoInPagina[] {
  if (!c) return [];
  const perIndice = new Map(foto.map((f) => [f.indice, f]));
  return c.scelte
    .filter((s) => s.stato === "selected")
    .slice()
    .sort((a, b) => a.ordine - b.ordine)
    .slice(0, MAX_IN_PAGINA)
    .map((s) => {
      const f = perIndice.get(s.indice);
      return f ? { ...f, ruolo: s.ruolo, object_position: s.object_position } : null;
    })
    .filter((f): f is FotoInPagina => f !== null);
}

/**
 * La generazione del sito puo partire?
 *
 * Tre condizioni, e sono tutte «non so» travestiti da «no»:
 *  - nessuna fotografia scelta: la pagina sarebbe muta;
 *  - la hero e da rivedere: e l'immagine che si vede per prima, e
 *    pubblicarla senza averla guardata e il difetto che ha fatto
 *    bocciare la versione precedente;
 *  - l'identita visiva e ancora inconcludente: non sappiamo se un logo
 *    esista, e comporre il nome senza saperlo significa scegliere per
 *    stanchezza.
 */
export function puoGenerare(
  c: CuratelaProgetto | null,
  brandInconcludente: boolean,
): { ok: boolean; motivo: string } {
  if (!c || c.scelte.filter((s) => s.stato === "selected").length === 0) {
    return { ok: false, motivo: "nessuna fotografia selezionata: la pagina non avrebbe immagini" };
  }
  const hero = c.scelte.find((s) => s.ruolo === "hero");
  if (!hero || hero.stato === "needs_review" || hero.stato === "unreviewed") {
    return { ok: false, motivo: "la fotografia di apertura non e stata decisa: e la prima cosa che si vede" };
  }
  if (brandInconcludente) {
    return { ok: false, motivo: "identita visiva ancora inconcludente: non sappiamo se esista un logo" };
  }
  return { ok: true, motivo: "" };
}

/** Firma del manifest: cambia se cambiano le fotografie o il loro
 *  ordine. Non e un hash del CONTENUTO — sono gli id, che gia
 *  conserviamo. */
export function firmaManifest(foto: readonly FotoDemo[]): string {
  return foto.map((f) => `${f.indice}:${f.id}`).join("|");
}
