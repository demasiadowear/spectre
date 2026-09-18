import { createHash } from "crypto";
import type { BrandOverall, MotivoBlocco } from "@/types/dossier";
import type { EsitoComando } from "./analisi-progetto";
import type { StatoPubblicazione } from "./pubblicazione";

// ============================================================
// L'esito dell'analisi e dell'approvazione, leggibile dai log.
//
// Stessa regola del collector: da qui escono NUMERI, ENUM e
// IDENTIFICATIVI TECNICI. Mai un nome, un URL, un riferimento del
// provider, una descrizione, un frammento di cio che il modello ha
// letto in un'immagine.
//
// UN CASO CHE NON SI VEDE A OCCHIO.
//
// `basis_revision` sembra un identificativo e non lo e del tutto:
// `condizioniDi()` ci mette dentro `attribuzione`, e l'attribuzione di
// una fotografia di Places e il NOME DELLA PERSONA che l'ha scattata.
// Scriverla nei log significa scrivere nomi di persone nei log. Qui
// esce il suo digest: cambia quando cambia la base, che e tutto cio che
// serve per leggere una riga di log, e non dice di chi.
//
// `manifest_revision` ha lo stesso trattamento per coerenza: la si
// confronta, non la si legge.
// ============================================================

export const EVENTO_ANALISI = "demo_analisi_finita";
export const EVENTO_APPROVAZIONE = "demo_proposta_approvata";

/**
 * L'apertura approvata non e piu servibile, e la pagina si e composta
 * con un'apertura testuale.
 *
 * Esiste perche questo guasto e invisibile: la demo si apre, risponde
 * 200 e sembra a posto. Senza questa riga lo si scopre solo aprendola,
 * e la si apre di solito dopo averla mandata a qualcuno.
 *
 * Non fa partire niente: e una constatazione, non un comando. La nuova
 * analisi la chiede una persona.
 */
export const EVENTO_HERO_MANCANTE = "published_hero_unavailable";

/** Dodici caratteri di sha256: bastano per dire «e cambiata» e non
 *  bastano per ricostruire niente. */
export function digest(v: string): string {
  if (!v) return "";
  return createHash("sha256").update(v).digest("hex").slice(0, 12);
}

/** Esiti dell'approvazione. Insieme chiuso, come tutto il resto. */
export type EsitoApprovazione =
  | "approvata"
  | "rifiutata"
  | "stale"            // la base e cambiata mentre l'operatore guardava
  | "concorrenza"      // qualcun altro ha approvato prima
  | "input_non_valido"
  | "marchio_non_risolto"
  | "marchio_bloccato"
  | "database_non_disponibile";

export interface RiepilogoProposta {
  event: string;
  project_id: string;
  lead_id: string;
  /** L'esito del comando, in una parola dell'insieme chiuso. */
  status: EsitoComando | EsitoApprovazione;
  http: number;
  /** Vuoto se non c'e blocco. Mai un messaggio, mai un nome. */
  blocco: MotivoBlocco;
  brand_status: BrandOverall | "";
  /** Digest, non contenuto. Vedi la nota in testa al modulo. */
  manifest_digest: string;
  basis_digest: string;
  /** Questo si puo scrivere: e un uuid troncato, non deriva da niente. */
  proposal_revision: string;
  /** Quante fotografie, per stato della curatela. */
  foto_totali: number;
  foto_selezionate: number;
  foto_da_rivedere: number;
  foto_scartate: number;
  foto_non_viste: number;
  /** Fotografie approvate che nel manifest di adesso non ci sono piu.
   *  Se sale, la pagina sta perdendo pezzi senza che nessuno lo sappia. */
  foto_mancanti: number;
  /** Costo. Numeri, non contenuto. */
  immagini_richieste: number;
  immagini_analizzate: number;
  immagini_fallite: number;
  token: number;
  pagine_lette: number;
  query_ricerca: number;
  duration_ms: number;
  /** La pubblicazione e avvenuta? Un'approvazione che non pubblica e il
   *  caso normale quando il marchio non e risolto, e va distinta. */
  pubblicata: boolean;
  /** `ok` oppure `degraded`: la pagina online e ancora quella
   *  approvata, oppure si apre ma le manca qualcosa. */
  stato_pubblicazione: StatoPubblicazione | "";
  /** true = la pagina si e composta con un'apertura TESTUALE perche
   *  quella fotografica non era piu servibile. */
  apertura_testuale: boolean;
}

export function riepilogoVuoto(
  event: string, projectId: string, leadId: string,
): RiepilogoProposta {
  return {
    event, project_id: projectId, lead_id: leadId,
    status: "completata", http: 200, blocco: "", brand_status: "",
    manifest_digest: "", basis_digest: "", proposal_revision: "",
    foto_totali: 0, foto_selezionate: 0, foto_da_rivedere: 0,
    foto_scartate: 0, foto_non_viste: 0, foto_mancanti: 0,
    immagini_richieste: 0, immagini_analizzate: 0, immagini_fallite: 0,
    token: 0, pagine_lette: 0, query_ricerca: 0, duration_ms: 0,
    pubblicata: false, stato_pubblicazione: "", apertura_testuale: false,
  };
}

/**
 * La riga per una demo che si e aperta senza la sua apertura.
 *
 * Esce da una pagina PUBBLICA, quindi contiene ancora meno del resto:
 * identificativi tecnici, la revisione approvata, e tre conteggi.
 * Niente slug — lo slug e la credenziale della demo, e un log e il
 * posto piu facile in cui farla leggere a qualcuno che non dovrebbe.
 */
export function scriviHeroMancante(input: {
  project_id: string;
  lead_id: string;
  proposal_revision: string;
  foto_in_pagina: number;
  foto_mancanti: number;
}): void {
  scriviRiepilogo({
    ...riepilogoVuoto(EVENTO_HERO_MANCANTE, input.project_id, input.lead_id),
    status: "completata",
    http: 200,
    proposal_revision: input.proposal_revision,
    foto_selezionate: input.foto_in_pagina,
    foto_mancanti: input.foto_mancanti,
    pubblicata: true,
    stato_pubblicazione: "degraded",
    apertura_testuale: true,
  });
}

/** Chiavi ammesse nella riga di log. Lista BIANCA e non nera: aggiungere
 *  un campo al riepilogo non deve poterlo far comparire nei log per
 *  distrazione. */
const CHIAVI_AMMESSE: readonly string[] = [
  "event", "project_id", "lead_id", "status", "http", "blocco",
  "brand_status", "manifest_digest", "basis_digest", "proposal_revision",
  "foto_totali", "foto_selezionate", "foto_da_rivedere", "foto_scartate",
  "foto_non_viste", "foto_mancanti",
  "immagini_richieste", "immagini_analizzate", "immagini_fallite",
  "token", "pagine_lette", "query_ricerca", "duration_ms", "pubblicata",
  "stato_pubblicazione", "apertura_testuale",
];

export function soloCampiAmmessi(r: RiepilogoProposta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CHIAVI_AMMESSE) {
    const v = (r as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Una riga sola, JSON, su stdout. Vercel la raccoglie cosi com'e. */
export function scriviRiepilogo(r: RiepilogoProposta): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(soloCampiAmmessi(r)));
}

/**
 * Dall'esito del comando al codice HTTP.
 *
 * Nessun 200 con un errore dentro: se l'analisi non e arrivata in
 * fondo, lo stato lo dice. Chi guarda i log deve poter contare i
 * fallimenti senza aprire i corpi delle risposte.
 */
export function httpAnalisi(e: EsitoComando): number {
  switch (e) {
    case "completata":
    case "invariata":
    case "nessuna_immagine":
      return 200;
    case "gia_in_corso":
      return 202;                       // la sta gia facendo qualcun altro
    case "progetto_assente":
    case "dossier_assente":
      return 422;                       // l'ingresso non denota niente
    case "dipendenza_fallita":
      return 424;                       // un fornitore non ha risposto
    case "bloccata":
    case "database_non_disponibile":
      return 503;                       // manca configurazione o runtime
    default:
      return 500;
  }
}

export function httpApprovazione(e: EsitoApprovazione): number {
  switch (e) {
    case "approvata":
    case "rifiutata":
      return 200;
    case "input_non_valido":
      return 422;
    case "stale":
    case "concorrenza":
    case "marchio_non_risolto":         // serve una nuova analisi, non una decisione
      return 409;
    case "marchio_bloccato":
    case "database_non_disponibile":
      return 503;
    default:
      return 500;
  }
}
