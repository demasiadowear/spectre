import type { FotoDemo } from "./foto";

// ============================================================
// La curatela fotografica: quali fotografie vanno in pagina, in che
// ordine, con quale ritaglio.
//
// L'IDENTITA DI UNA FOTOGRAFIA E `candidate_id`, NON L'INDICE.
//
// L'indice e una POSIZIONE nell'elenco che Places restituisce, e quella
// posizione non e una proprieta della fotografia: e una proprieta di
// come Google ce l'ha consegnata quel giorno. Una nuova raccolta puo
// riordinare le stesse dieci immagini, e «indice 3» diventa un'altra
// foto senza che niente sembri cambiato.
//
// `candidate_id` e `sha256(provider_reference)`: assegnato
// all'ingestione, identico se lo stesso riferimento ricompare, opaco,
// indipendente dall'ordine e non derivato dal contenuto dell'immagine.
//
// La rotta pubblica continua a usare `/foto/3`, e va bene: quel 3 e
// risolto dalla revisione PUBBLICATA del progetto, che e ferma. Nel
// dominio interno — proposta, approvazione, validazione — si usa solo
// `candidate_id`.
//
// TRE REVISIONI, NON UNA.
//
//   manifest_revision          fotografia esatta del manifest
//   selection_basis_revision   identita e condizioni delle SOLE foto
//                              usate dalla proposta
//   proposal_revision          versione della composizione approvata
//
// La validita dipende dalla seconda. Legarla alla prima invaliderebbe
// una proposta perfetta perche Places ha aggiunto una foto che non
// usiamo — cioe per un fatto che non ha niente a che vedere con la
// pagina che abbiamo composto.
// ============================================================

/**
 * LA DECISIONE DI CURATELA. Un asse solo, e non e quello del marchio.
 *
 * Confonderli e costato una proposta reale: dieci fotografie, nove
 * escluse perche il modello aveva visto un marchio o un volto, e in
 * pagina e rimasta l'unica immagine che non conteneva niente — un
 * mucchio di asciugamani. Il sistema aveva ottimizzato l'ASSENZA di
 * marchi e persone invece della qualita commerciale.
 *
 * Adesso il marchio e un'osservazione (vedi `OsservazioneMarchio`) e la
 * curatela e una decisione. Solo alcune osservazioni la cambiano.
 */
export type StatoCuratela =
  | "unreviewed"           // nessuno l'ha guardata, nemmeno il modello
  | "selected"
  | "not_selected"
  | "needs_visual_review"  // serve l'occhio di una persona
  /** @deprecated Nome storico di `needs_visual_review`. Si legge, non si
   *  scrive: `leggiProposta` lo traduce. */
  | "needs_review";

/** Ruolo di impaginazione: una decisione di layout, non una
 *  descrizione di cosa mostra la fotografia. */
export type RuoloLayout = "hero" | "treatment" | "interior" | "detail" | "closing";

/**
 * Cio che si conserva di una fotografia scelta. Solo impaginazione:
 * nessuna descrizione, nessun punteggio, nessuna motivazione —
 * lib/demo/policy-media.ts e la nota sul regime Places.
 */
export interface SceltaFoto {
  /** L'identita stabile. Mai l'indice. */
  candidate_id: string;
  /** Posizione in pagina, da 0. */
  order: number;
  layout_role: RuoloLayout;
  /** `object-position`, es. "50% 28%". */
  object_position: string;
  stato: StatoCuratela;
}

export interface CuratelaProgetto {
  /** Le condizioni delle sole fotografie usate: e da questa che
   *  dipende la validita. */
  basis_revision: string;
  /** Il manifest intero al momento della composizione. Non decide la
   *  validita: serve a sapere se sono comparse foto nuove. */
  manifest_revision: string;
  /** Versione della composizione approvata. Cambia a ogni
   *  approvazione, anche se le fotografie sono le stesse. */
  proposal_revision: string;
  scelte: SceltaFoto[];
  da_rivedere: { candidate_id: string; motivo: MotivoRevisione }[];
  composta_il: string;
}

/** Perche serve una persona. Nessuna voce descrive il CONTENUTO: sono
 *  stati della decisione, non dell'immagine. */
export type MotivoRevisione =
  | "bassa_confidenza"
  | "possibile_persona_identificabile"
  // I due marchi che fermano, distinti. Un marchio INCIDENTALE — le
  // confezioni sullo scaffale, il logo sul flacone — non e in questo
  // elenco perche non ferma niente: si vede in ogni fotografia di ogni
  // centro estetico del mondo, e trattarlo come un ostacolo significa
  // scartare il mestiere insieme al marchio.
  | "marchio_attivita_possibile"   // forse e l'insegna del cliente: conta
  | "marchio_estraneo_dominante"   // un marchio altrui domina l'inquadratura
  | "qualita_insufficiente"        // buia, sfocata, soggetto illeggibile
  /** Tessili ammassati, deposito, soffitto: non sono fotografie di
   *  un'attivita, sono fotografie di cose che ci stanno dentro. E la
   *  sola esclusione per COSA si vede, e l'elenco e chiuso. */
  | "genere_non_utilizzabile"
  | "analisi_non_disponibile"
  /** @deprecated Sostituito dai due marchi distinti. Si legge, non si
   *  scrive. */
  | "possibile_marchio";

export const RITAGLIO_PREDEFINITO = "50% 50%";
export const MAX_IN_PAGINA = 5;

/** Quante fotografie servono perche una proposta sia una pagina. */
export const MIN_IN_PAGINA = 3;

/** Perche una proposta non e utilizzabile. Insieme chiuso. */
export type CodiceProposta =
  | ""
  | "no_usable_media_selected"   // non ne ha scelta nessuna
  | "insufficient_usable_media"  // troppo poche rispetto a quante ce n'erano
  | "no_hero_candidate";         // nessuna merita l'apertura

export type StatoProposta = "complete" | "incomplete";

/**
 * LA REGOLA, IN UN POSTO SOLO.
 *
 * Esisteva in tre: il compositore calcolava `insufficient_usable_media`
 * e non lo salvava, la rotta del provino ricalcolava solo «zero», e
 * l'approvazione non controllava niente. Risultato: «Approva e
 * pubblica» acceso su una proposta di UNA fotografia, con la regola
 * gia scritta e mai applicata.
 *
 * Adesso la calcolano tutti da qui, sullo stato salvato — che e
 * l'unico modo perche non possano essere in disaccordo.
 */
export function valutaProposta(scelte: readonly SceltaFoto[]): {
  proposal_status: StatoProposta;
  codice: CodiceProposta;
  selezionate: number;
  candidati: number;
  apertura: boolean;
} {
  const selezionate = scelte.filter((s) => s.stato === "selected").length;
  // I candidati sono le fotografie che l'analisi ha davvero guardato:
  // quelle mai viste non fanno testo su quanto materiale c'era.
  const candidati = scelte.filter((s) => s.stato !== "unreviewed").length;
  const apertura = scelte.some((s) => s.stato === "selected" && s.layout_role === "hero");

  const codice: CodiceProposta =
    scelte.length === 0 ? ""
    : selezionate === 0 ? "no_usable_media_selected"
    // Meno del minimo, ma solo se il materiale c'era: un'attivita con
    // due fotografie in tutto non ha una proposta incompleta.
    : selezionate < MIN_IN_PAGINA && candidati >= MIN_IN_PAGINA ? "insufficient_usable_media"
    : !apertura ? "no_hero_candidate"
    : "";

  return {
    // `no_hero_candidate` NON rende incompleta la proposta: la pagina si
    // apre con il nome, ed e una composizione legittima.
    proposal_status:
      codice === "no_usable_media_selected" || codice === "insufficient_usable_media"
        ? "incomplete" : "complete",
    codice, selezionate, candidati, apertura,
  };
}

export const SEQUENZA_RUOLI: readonly RuoloLayout[] = [
  "hero", "treatment", "interior", "detail", "closing",
];

export interface FotoInPagina extends FotoDemo {
  layout_role: RuoloLayout;
  object_position: string;
}

// ----- Le tre revisioni ---------------------------------------------

/**
 * Le CONDIZIONI di una fotografia: cio che, cambiando, rende invalida
 * una scelta gia presa.
 *
 * Non e un hash dei pixel. Sono i quattro fatti che determinano se
 * quella fotografia si puo ancora mostrare come l'avevamo scelta: chi
 * e, se si puo mostrare, sotto quale regime, e con quale attribuzione.
 * Se l'autore cambia, l'attribuzione stampata sotto l'immagine
 * diventerebbe sbagliata — ed e una riga che nessuno rilegge.
 */
export function condizioniDi(f: FotoDemo): string {
  return [f.id, f.display_status, f.rights_status, f.attribuzione].join("~");
}

/** Fotografia esatta del manifest: quali foto, in quale ordine. */
export function manifestRevision(foto: readonly FotoDemo[]): string {
  return foto.map((f) => f.id).join("|");
}

/**
 * Le condizioni delle sole fotografie SCELTE, ordinate per id.
 *
 * Ordinate per id e non per posizione di proposito: riordinare la
 * pagina e una decisione nostra e non deve invalidare niente, mentre
 * cambiare una condizione si.
 */
export function selectionBasisRevision(
  scelte: readonly SceltaFoto[],
  foto: readonly FotoDemo[],
): string {
  const perId = new Map(foto.map((f) => [f.id, f]));
  return scelte
    .filter((s) => s.stato === "selected")
    .map((s) => s.candidate_id)
    .sort()
    .map((id) => {
      const f = perId.get(id);
      return f ? condizioniDi(f) : `${id}~ASSENTE`;
    })
    .join("|");
}

// ----- Validazione selettiva ----------------------------------------

export type EsitoValidazione =
  | { stato: "assente" }
  | { stato: "valida"; outdated: boolean; nuove: number }
  | { stato: "stale"; motivo: MotivoStale; candidate_id: string };

/** Perche una proposta non vale piu. Tutti riguardano una fotografia
 *  SCELTA: quello che succede alle altre non la tocca. */
export type MotivoStale =
  | "foto_scomparsa"
  | "non_piu_mostrabile"
  | "regime_diritti_cambiato"
  | "attribuzione_cambiata";

const mostrabile = (f: FotoDemo) =>
  f.display_status === "display_allowed"
  || f.display_status === "display_allowed_with_attribution";

/**
 * La proposta vale ancora?
 *
 * Si guardano SOLO le fotografie scelte. Che Places abbia riordinato
 * l'elenco, tolto una foto che non usavamo o aggiunto una nuova non
 * cambia niente di quello che abbiamo composto — e invalidare per quei
 * motivi significherebbe rifare l'analisi, e ripagarla, per un fatto
 * che non ci riguarda.
 *
 * Le foto nuove non invalidano: segnalano. `outdated` dice che c'e
 * materiale che nessuno ha ancora guardato, e la demo esistente resta
 * in piedi.
 */
export function validaProposta(
  c: CuratelaProgetto | null,
  foto: readonly FotoDemo[],
): EsitoValidazione {
  if (!c) return { stato: "assente" };

  const perId = new Map(foto.map((f) => [f.id, f]));
  const scelte = c.scelte.filter((s) => s.stato === "selected");

  for (const s of scelte) {
    const f = perId.get(s.candidate_id);
    if (!f) return { stato: "stale", motivo: "foto_scomparsa", candidate_id: s.candidate_id };
    if (!mostrabile(f)) {
      return { stato: "stale", motivo: "non_piu_mostrabile", candidate_id: s.candidate_id };
    }
  }

  // Le condizioni: il confronto e sulla stringa che le riassume, cosi
  // un campo aggiunto domani entra nel controllo da solo.
  const attuale = selectionBasisRevision(c.scelte, foto);
  if (attuale !== c.basis_revision) {
    // Si dice QUALE e cambiata, non solo che qualcosa e cambiato.
    for (const s of scelte) {
      const f = perId.get(s.candidate_id);
      if (!f) continue;
      const prima = c.basis_revision.split("|").find((x) => x.startsWith(`${s.candidate_id}~`));
      if (!prima || prima === condizioniDi(f)) continue;
      const campiPrima = prima.split("~");
      const motivo: MotivoStale =
        campiPrima[2] !== f.rights_status ? "regime_diritti_cambiato"
        : campiPrima[3] !== f.attribuzione ? "attribuzione_cambiata"
        : "non_piu_mostrabile";
      return { stato: "stale", motivo, candidate_id: s.candidate_id };
    }
    return { stato: "stale", motivo: "foto_scomparsa", candidate_id: "" };
  }

  // Fotografie comparse DOPO la composizione: e a questo che serve
  // `manifest_revision`, che altrimenti non deciderebbe niente.
  //
  // Il confronto e con il manifest di allora, non con le scelte: una
  // proposta puo legittimamente non nominare una fotografia che ha
  // visto e scartato, e contarla come «nuova» segnalerebbe materiale
  // da guardare che invece e gia stato guardato.
  const allora = new Set(c.manifest_revision.split("|").filter(Boolean));
  const nuove = foto.filter((f) => !allora.has(f.id)).length;
  return { stato: "valida", outdated: nuove > 0, nuove };
}

/**
 * Applica una curatela, rimappando per `candidate_id`.
 *
 * Se Places ha riordinato, qui non cambia niente: si cerca per
 * identita, non per posizione. E la ragione per cui questa funzione
 * non vede mai un indice.
 */
export function applicaCuratela(
  foto: readonly FotoDemo[],
  c: CuratelaProgetto | null,
): FotoInPagina[] {
  const v = validaProposta(c, foto);
  if (v.stato !== "valida" || !c) return [];

  const perId = new Map(foto.map((f) => [f.id, f]));
  return c.scelte
    .filter((s) => s.stato === "selected")
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_IN_PAGINA)
    .map((s) => {
      const f = perId.get(s.candidate_id);
      return f ? { ...f, layout_role: s.layout_role, object_position: s.object_position } : null;
    })
    .filter((f): f is FotoInPagina => f !== null);
}

// ----- Le scelte che arrivano da fuori -------------------------------

export interface SceltaInviata {
  candidate_id: string;
  order: number;
  layout_role: RuoloLayout;
  object_position: string;
}

const RITAGLIO = /^\d{1,3}% \d{1,3}%$/;

/**
 * Legge le scelte inviate dall'operatore, o dice perche non vanno bene.
 *
 * Ogni rifiuto e specifico. «Input non valido» non dice a nessuno cosa
 * sistemare, e chi lo legge ricarica la pagina e riprova uguale.
 *
 * L'identita si verifica sul manifest di ADESSO: un `candidate_id` che
 * non c'e piu non e un ingresso da correggere, e una fotografia che non
 * esiste — e la differenza fra «hai sbagliato a scrivere» e «mentre
 * guardavi, Places l'ha tolta».
 */
export function validaScelteInviate(
  grezzo: unknown,
  foto: readonly FotoDemo[],
): SceltaInviata[] | string {
  if (!Array.isArray(grezzo)) return "serve l'elenco delle fotografie scelte";
  if (grezzo.length === 0) return "nessuna fotografia selezionata: la pagina non avrebbe immagini";
  if (grezzo.length > MAX_IN_PAGINA) return `al massimo ${MAX_IN_PAGINA} fotografie in pagina`;

  const disponibili = new Set(foto.map((f) => f.id));
  const viste = new Set<string>();
  const out: SceltaInviata[] = [];

  for (const x of grezzo) {
    if (!x || typeof x !== "object") return "una scelta non è leggibile";
    const o = x as Record<string, unknown>;
    const id = typeof o.candidate_id === "string" ? o.candidate_id.trim() : "";
    if (!id) return "una scelta non ha l'identificativo della fotografia";
    if (!disponibili.has(id)) return "una fotografia scelta non è più disponibile: riesegui l'analisi";
    if (viste.has(id)) return "la stessa fotografia compare due volte";
    viste.add(id);

    const ruolo = String(o.layout_role ?? "");
    if ((SEQUENZA_RUOLI as readonly string[]).indexOf(ruolo) === -1) {
      return "ruolo di impaginazione non riconosciuto";
    }
    const pos = typeof o.object_position === "string" ? o.object_position.trim() : "";
    if (pos && !RITAGLIO.test(pos)) return "il ritaglio non è nella forma «50% 30%»";

    const order = Number(o.order);
    out.push({
      candidate_id: id,
      order: Number.isInteger(order) && order >= 0 ? order : out.length,
      layout_role: ruolo as RuoloLayout,
      object_position: pos || RITAGLIO_PREDEFINITO,
    });
  }

  // ZERO APERTURE E AMMESSO. Nessuna fotografia ha superato il gate, o
  // l'operatore le ha tolte tutte dall'apertura: la pagina si apre con
  // il nome, che e una composizione progettata e non un buco. Quello
  // che non si puo fare e averne DUE.
  if (out.filter((s) => s.layout_role === "hero").length > 1) {
    return "c'è più di una fotografia di apertura";
  }

  // Si rinumera: l'ordine che conta e quello relativo, e un client che
  // manda 0, 5, 7 ha comunque espresso una sequenza.
  return out.slice().sort((a, b) => a.order - b.order).map((s, i) => ({ ...s, order: i }));
}

/**
 * La generazione puo partire?
 *
 * `NOT_FOUND` sull'identita visiva NON blocca: una attivita senza logo
 * e un caso normale, e il nome si compone tipograficamente.
 */
export function puoGenerare(
  c: CuratelaProgetto | null,
  foto: readonly FotoDemo[],
  brandBloccante: boolean,
): { ok: boolean; motivo: string } {
  const v = validaProposta(c, foto);
  if (v.stato === "assente") {
    return { ok: false, motivo: "nessuna proposta: va eseguita l'analisi" };
  }
  if (v.stato === "stale") {
    return { ok: false, motivo: `proposta non piu valida (${v.motivo}): va rieseguita l'analisi` };
  }
  if (!c || c.scelte.filter((s) => s.stato === "selected").length === 0) {
    return { ok: false, motivo: "nessuna fotografia selezionata: la pagina non avrebbe immagini" };
  }
  // Nessun controllo sull'apertura: una pagina che si apre con il nome
  // e una composizione legittima. Vedi `validaScelteInviate`.
  if (brandBloccante) {
    return { ok: false, motivo: "identita visiva non ancora risolta" };
  }
  return { ok: true, motivo: "" };
}
