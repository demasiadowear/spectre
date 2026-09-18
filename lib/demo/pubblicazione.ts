import { MAX_IN_PAGINA, type CuratelaProgetto, type FotoInPagina, type RuoloLayout } from "./curatela";
import type { FotoDemo } from "./foto";
import type { BrandOverall } from "@/types/dossier";

// ============================================================
// Cio che la demo MOSTRA, che non e cio che e stato proposto.
//
// La proposta e un documento di lavoro: si modifica, si scarta, si
// rifa. La pubblicazione e una fotografia ferma di una decisione presa,
// e vive in una riga separata perche una nuova pubblicazione che non
// riesce non deve poter portarsi via quella che regge.
//
// NELLA SPEC NON CI SONO INDICI.
//
// L'indice e la posizione nell'elenco che Places ha restituito quel
// giorno. Congelarlo qui vorrebbe dire che alla prossima raccolta
// «apertura: indice 3» diventa un'altra fotografia senza che niente
// sembri cambiato — ed e esattamente il modo in cui in pagina compare
// una foto che nessuno ha scelto. Nella spec ci sono `candidate_id`, e
// l'indice si risolve a ogni richiesta sul manifest di quel momento.
//
// NESSUNA SOSTITUZIONE SILENZIOSA.
//
// Se la fotografia di apertura non c'e piu, non ne sale un'altra al suo
// posto. Il ruolo resta vuoto, la pagina si compone con cio che ha e
// l'operatore vede che manca. Promuovere la seconda foto ad apertura
// sarebbe una decisione presa da un programma su cio che il prospect
// vede per primo.
// ============================================================

export interface VoceImpaginata {
  candidate_id: string;
  order: number;
  layout_role: RuoloLayout;
  object_position: string;
}

export interface SpecPubblicata {
  proposal_revision: string;
  /** Le condizioni delle foto al momento della pubblicazione. Serve a
   *  sapere, rileggendola, se cio che e online e ancora cio che e stato
   *  approvato. */
  basis_revision: string;
  foto: VoceImpaginata[];
  /**
   * L'apertura e una fotografia, oppure e il nome.
   *
   * `NEEDS_REVIEW` non e un guasto e non e una fotografia mancante: e
   * una composizione legittima, decisa perche nessuna immagine ha
   * superato il gate dell'apertura. La pagina si apre con il nome, e
   * quella e la variante progettata — non un ripiego.
   */
  hero_status: "OK" | "NEEDS_REVIEW";
  brand_status: BrandOverall;
  /** Cosa il generatore ha avuto il permesso di usare. `tipografia`
   *  NON significa «logo»: significa che un marchio non c'era. */
  uso_marchio: "logo_originale" | "logo_da_approvare" | "riferimento_insegna" | "tipografia";
  pubblicata_il: string;
}

/** Costruisce la spec da una curatela approvata. Funzione pura: la
 *  decisione di scriverla sta altrove, e passa da un controllo che
 *  questa funzione non conosce. */
export function componiSpec(
  c: CuratelaProgetto,
  uso: SpecPubblicata["uso_marchio"],
  brand: BrandOverall,
): SpecPubblicata {
  const conApertura = c.scelte.some(
    (s) => s.stato === "selected" && s.layout_role === "hero",
  );
  const foto = c.scelte
    .filter((s) => s.stato === "selected")
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_IN_PAGINA)
    .map((s, i) => ({
      candidate_id: s.candidate_id,
      order: i,
      layout_role: s.layout_role,
      object_position: s.object_position,
    }));
  return {
    proposal_revision: c.proposal_revision,
    basis_revision: c.basis_revision,
    hero_status: conApertura ? "OK" : "NEEDS_REVIEW",
    foto,
    brand_status: brand,
    uso_marchio: uso,
    pubblicata_il: new Date().toISOString(),
  };
}

export interface EsitoRisoluzione {
  foto: FotoInPagina[];
  /** Le fotografie approvate che nel manifest di adesso non ci sono
   *  piu. Non vengono sostituite: si contano. */
  mancanti: string[];
  /** true = l'apertura approvata non e piu disponibile. La pagina si
   *  compone con un'apertura TESTUALE, non con un'altra fotografia. */
  apertura_mancante: boolean;
  /** Lo stato della pubblicazione: `degraded` quando la pagina non e
   *  piu quella approvata. Vedi `statoPubblicazione`. */
  stato: StatoPubblicazione;
}

/**
 * `ok` = la pagina online e quella approvata.
 * `degraded` = e online e si apre, ma manca qualcosa che era stato
 *              approvato.
 *
 * NON e uno stato salvato, ed e una scelta. Una fotografia che sparisce
 * da Places puo ricomparire alla raccolta dopo: una colonna scritta il
 * giorno in cui e sparita resterebbe `degraded` per sempre, e un
 * indicatore che non torna mai indietro smette di essere letto. Qui si
 * calcola sul manifest di adesso, a ogni richiesta, e non puo mentire
 * in nessuna delle due direzioni.
 */
export type StatoPubblicazione = "ok" | "degraded";

export function statoPubblicazione(
  spec: SpecPubblicata | null,
  foto: readonly FotoDemo[],
): StatoPubblicazione {
  if (!spec || spec.foto.length === 0) return "ok";
  const presenti = new Set(foto.map((f) => f.id));
  return spec.foto.every((v) => presenti.has(v.candidate_id)) ? "ok" : "degraded";
}

/**
 * Dalla spec pubblicata alle fotografie da mettere in pagina.
 *
 * L'unica traduzione che avviene qui e da identita a posizione: il
 * `src` viene da `FotoDemo`, che e stato costruito sul manifest di
 * adesso, quindi l'indice nell'URL e sempre quello giusto.
 */
export function risolviSpec(
  spec: SpecPubblicata | null,
  foto: readonly FotoDemo[],
): EsitoRisoluzione {
  if (!spec || spec.foto.length === 0) {
    return { foto: [], mancanti: [], apertura_mancante: false, stato: "ok" };
  }
  const perId = new Map(foto.map((f) => [f.id, f]));
  const out: FotoInPagina[] = [];
  const mancanti: string[] = [];
  let apertura_mancante = false;

  for (const v of spec.foto.slice().sort((a, b) => a.order - b.order)) {
    const f = perId.get(v.candidate_id);
    if (!f) {
      mancanti.push(v.candidate_id);
      if (v.layout_role === "hero") apertura_mancante = true;
      continue;
    }
    // Il ruolo e il ritaglio restano quelli approvati. Non si riassegna
    // niente: se manca l'apertura, manca l'apertura.
    out.push({ ...f, layout_role: v.layout_role, object_position: v.object_position });
  }
  return {
    foto: out, mancanti, apertura_mancante,
    stato: mancanti.length > 0 ? "degraded" : "ok",
  };
}

/** Il marchio si puo mettere in pagina? `tipografia` non e un logo, e
 *  la pagina non deve chiamarlo cosi. */
export function marchioInPagina(spec: SpecPubblicata | null): boolean {
  return spec?.uso_marchio === "logo_originale";
}
