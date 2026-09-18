import type { BusinessDossier, MediaCandidate } from "@/types/dossier";

// ============================================================
// Quali fotografie puo mostrare una demo, e come si nominano.
//
// IL PROBLEMA. La demo si apre senza login — deve, altrimenti il
// prospect non la vede. Ma la rotta che rende le fotografie di Places
// ha la chiave API sul server: se accettasse un riferimento scelto da
// chi chiama, diventerebbe un proxy pubblico che scarica qualunque
// fotografia di qualunque attivita a spese nostre, e chiunque trovasse
// uno slug potrebbe usarlo come endpoint aperto.
//
// LA SOLUZIONE. Il client non nomina MAI una fotografia. Passa solo un
// INDICE, e il server lo risolve dentro il manifest di QUEL progetto:
//
//     /demo/<slug>/foto/3        ->  candidates[3].provider_reference
//
// Cosi non esiste un input che possa denotare una fotografia fuori dal
// dossier di quel progetto. Non c'e un URL da validare, non c'e un
// riferimento da filtrare, non c'e una firma che possa scadere male:
// l'insieme di cio che si puo chiedere E l'insieme di cio che si puo
// mostrare. Un indice fuori intervallo non e un permesso negato, e una
// fotografia che non esiste.
//
// La chiave resta dove sta: dentro la rotta, mai in una risposta,
// mai in un messaggio d'errore, mai in un log.
// ============================================================

/** Un indice valido: una o due cifre, niente altro. Non accetta `+1`,
 *  `1e2`, spazi o segni — che `Number()` da solo tollererebbe. */
export const INDICE_FOTO = /^\d{1,2}$/;

export interface FotoDemo {
  /** Identificativo del candidato nel manifest: e la chiave a cui si
   *  aggancia la curatela, e non cambia se il manifest si riordina. */
  id: string;
  /** Posizione nel manifest: e l'unico nome che il client conosce. */
  indice: number;
  /** Percorso da mettere in `src`. Non contiene il riferimento. */
  src: string;
  larghezza: number;
  altezza: number;
  /** Testo che il provider impone di mostrare accanto all'immagine. */
  attribuzione: string;
  /** true = l'attribuzione non e facoltativa. */
  attribuzione_obbligatoria: boolean;
}

/** Le fotografie mostrabili di un dossier, gia numerate.
 *  L'indice e quello del manifest COMPLETO, non della lista filtrata:
 *  altrimenti il numero che il client manda e il numero che il server
 *  risolve smetterebbero di essere lo stesso al primo scarto. */
export function fotoMostrabili(d: BusinessDossier, slug: string, w = 1200): FotoDemo[] {
  const approvate = d.media?.approved_ids ?? [];
  const out: FotoDemo[] = [];
  (d.media?.candidates ?? []).forEach((m, i) => {
    if (!mostrabile(m, approvate)) return;
    out.push({
      id: m.id,
      indice: i,
      src: `/demo/${encodeURIComponent(slug)}/foto/${i}?w=${w}`,
      larghezza: m.width,
      altezza: m.height,
      attribuzione: m.attribution,
      attribuzione_obbligatoria: m.display_status === "display_allowed_with_attribution",
    });
  });
  return out;
}

function mostrabile(m: MediaCandidate, approvate: readonly string[]): boolean {
  return m.display_status === "display_allowed"
    || m.display_status === "display_allowed_with_attribution"
    || approvate.indexOf(m.id) !== -1;
}

export type EsitoRisoluzione =
  | { ok: true; riferimento: string }
  | { ok: false; motivo: "indice_non_valido" | "fuori_intervallo" | "non_mostrabile" };

/**
 * Dall'indice al riferimento del provider, dentro un dossier solo.
 *
 * Tre rifiuti distinti, perche sono tre cose diverse: una richiesta
 * malformata, una fotografia che non c'e, e una che c'e ma non si puo
 * mostrare. Verso l'esterno diventano tutte «non trovata» — la demo
 * non deve poter essere usata per sapere quante fotografie ha un
 * dossier ne quali sono state approvate.
 */
export function riferimentoPerIndice(
  d: BusinessDossier | null,
  grezzo: string,
): EsitoRisoluzione {
  if (!INDICE_FOTO.test(grezzo)) return { ok: false, motivo: "indice_non_valido" };
  const i = Number(grezzo);
  const candidati = d?.media?.candidates ?? [];
  if (i >= candidati.length) return { ok: false, motivo: "fuori_intervallo" };

  const m = candidati[i];
  if (!mostrabile(m, d?.media?.approved_ids ?? [])) {
    return { ok: false, motivo: "non_mostrabile" };
  }
  if (!m.provider_reference) return { ok: false, motivo: "non_mostrabile" };
  return { ok: true, riferimento: m.provider_reference };
}
