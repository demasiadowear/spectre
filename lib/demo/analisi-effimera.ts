import { SchemaType } from "@google/generative-ai";
import { gemini, COMPLEX_MODEL } from "@/lib/gemini";
import { classificaGuasto, guastoDiConfigurazione, type Guasto } from "@/lib/collector/guasti";
import { puoPersistereSemantica, senzaSemantica } from "./policy-media";
import {
  MAX_IN_PAGINA, RITAGLIO_PREDEFINITO, SEQUENZA_RUOLI,
  type MotivoRevisione, type RuoloLayout, type SceltaFoto,
} from "./curatela";
import type { RightsStatus } from "@/types/dossier";

// ============================================================
// Analisi visuale EFFIMERA.
//
// Il modello guarda le fotografie e propone quali mostrare, in che
// ordine e con quale ritaglio. Per le immagini di Google Places quello
// che ha LETTO nell'immagine — soggetti, testo, marchi, colori,
// punteggi, motivazioni — non esce da questa funzione.
//
// LA GARANZIA E NEL TIPO, NON NELLA DISCIPLINA.
//
// `Osservazione` e la forma completa della risposta del modello, ed e
// una struttura LOCALE: non e esportata e non compare in nessun tipo
// restituito. Cio che esce e `Proposta`, che contiene soltanto
// impaginazione. Un campo semantico non puo finire nel database perche
// non esiste una variabile, fuori di qui, che possa contenerlo.
//
// Poi c'e `senzaSemantica()` come rete, perche fra un tipo e il disco
// c'e `JSON.stringify`, che i tipi non li vede.
//
// ------------------------------------------------------------
// PERCHE LA PRIMA VERSIONE HA RESTITUITO ZERO SELEZIONI SU DIECI
// FOTOGRAFIE BUONE.
//
// Chiedeva JSON libero con chiavi ITALIANE e nessuno schema, poi lo
// leggeva in modo STRETTO. Rigiocando dieci forme plausibili della
// risposta attraverso quel lettore, SEI finivano a zero selezioni e
// QUATTRO lo facevano in silenzio — senza un errore, senza un motivo
// di revisione, senza niente di storto da nessuna parte:
//
//   chiavi inglesi (index/role/confidence) ......... 10 scartate
//   oggetto avvolto in una chiave diversa .......... 0 elementi letti
//   `adatta` come stringa «si» ...................... 0 selezionate
//   `adatta` omesso ma ruolo presente ............... 0 selezionate
//   ruoli in italiano (apertura/ambiente) ........... 0 selezionate
//   confidenza in percentuale (90 invece di 0.9) .... 10 needs_review
//
// L'ultimo e il piu istruttivo: `frazione(v, 0)` rifiutava 90 perche
// fuori da [0,1] e ripiegava su ZERO. Cioe: «non ho saputo leggere la
// confidenza» diventava «il modello non e per niente sicuro», che e il
// contrario. Un valore non letto non e un valore basso.
//
// Tre correzioni, in quest'ordine di forza:
//
//  1. UNO SCHEMA. `responseSchema` vincola chiavi, tipi ed enum alla
//     fonte. Toglie di mezzo cinque delle sei forme, e non per
//     tolleranza: perche non possono piu arrivare.
//  2. UN INDICE TEMPORANEO. Il modello nomina le immagini con
//     `image_index` 0..n-1 del LOTTO INVIATO, non con l'indice del
//     manifest. Subito dopo la risposta si traduce sullo snapshot del
//     lotto. Il modello non vede mai un `candidate_id` e non puo
//     restituirne uno.
//  3. TOLLERANZA COMUNQUE. Uno schema e una richiesta, non una
//     garanzia: se il modello sbanda, si normalizza invece di
//     scartare. E dove non si capisce, si dice «non lo so» — mai zero.
//
// NOTA GIURIDICA: questa modalita NON e dichiarata conforme. E una
// lettura nostra di §3.2.3(c) dei Google Maps Platform ToS in attesa
// di risposta scritta — vedi docs/GOOGLE-MAPS-PHOTO-CLARIFICATION.md.
// ============================================================

/**
 * La risposta del modello, normalizzata. LOCALE di proposito: non si
 * esporta, e nessuna funzione pubblica la restituisce.
 *
 * `confidenza` e `adatta` sono `null` quando il modello non l'ha detto
 * o l'ha detto in un modo che non si e potuto leggere. `null` non e
 * zero e non e false: e l'assenza di un'opinione, e si tratta come
 * tale.
 */
interface Osservazione {
  /** Posizione nel LOTTO inviato, 0..n-1. Mai l'indice del manifest,
   *  mai un candidate_id. */
  image_index: number;
  ruolo: RuoloLayout | "none";
  fuoco_x: number;
  fuoco_y: number;
  adatta: boolean | null;
  confidenza: number | null;
  persona_identificabile: boolean;
  marchio_visibile: boolean;
}

/**
 * Lo stato dell'ANALISI, distinto da quello della proposta.
 *
 * `NEEDS_REVIEW` non vuol dire che qualcosa si e rotto: vuol dire che
 * il risultato non e utilizzabile com'e e lo deve guardare una persona.
 * Una corsa che analizza dieci fotografie e non ne sceglie nessuna e
 * finita, ma non ha prodotto una proposta.
 */
export type StatoAnalisi = "OK" | "NEEDS_REVIEW";

/** Perche la proposta non e completa. Insieme chiuso. */
export type CodiceProposta = "" | "no_usable_media_selected";

/**
 * I contatori STRUTTURALI dell'interpretazione.
 *
 * Nessuno dice cosa c'era nelle immagini: dicono quanti oggetti sono
 * tornati, quanti si sono agganciati a una fotografia, quanti sono
 * caduti e dove. Senza, «zero selezionate» e una parola sola per sei
 * guasti diversi — ed e esattamente quello che e successo.
 */
export interface ContiInterpretazione {
  model_items_returned: number;
  mapped_items: number;
  invalid_indices: number;
  duplicate_indices: number;
  selected_count: number;
  needs_review_count: number;
  parse_failures: number;
}

export const CONTI_VUOTI: ContiInterpretazione = {
  model_items_returned: 0, mapped_items: 0, invalid_indices: 0,
  duplicate_indices: 0, selected_count: 0, needs_review_count: 0,
  parse_failures: 0,
};

/** Cio che esce. Solo impaginazione e numeri. */
export interface Proposta {
  scelte: SceltaFoto[];
  da_rivedere: { candidate_id: string; motivo: MotivoRevisione }[];
  costo: { richieste: number; analizzate: number; fallite: number; token: number; ms: number };
  modello: string;
  esito: "ok" | "non_configurato" | "nessuna_immagine" | "modello_non_disponibile";
  /** `null` quando non c'e stato nessun guasto. Un enum e un enum:
   *  distingue «riprova fra un minuto» da «finche non aggiungi una
   *  credenziale non serve riprovare». */
  guasto: Guasto | null;
  analysis_status: StatoAnalisi;
  codice: CodiceProposta;
  conti: ContiInterpretazione & { images_requested: number; images_downloaded: number; images_sent: number };
}

export interface FotoDaAnalizzare {
  /** L'identita stabile. Il modello non la vede mai. */
  candidate_id: string;
  /** Indice nel manifest. Serve a scaricare i byte, non a parlare col
   *  modello: quello usa la posizione nel lotto. */
  indice: number;
  rights_status: RightsStatus;
  carica: () => Promise<{ base64: string; mime: string } | null>;
}

const ISTRUZIONI = [
  "Osservi fotografie di un'attivita commerciale per deciderne l'IMPAGINAZIONE.",
  "Ogni immagine e preceduta da una riga «image_index: N». Usa QUEL numero.",
  "",
  "Per ogni immagine restituisci un oggetto con:",
  "- image_index: il numero della riga che precede l'immagine;",
  "- role: hero, treatment, interior, detail, closing, oppure none;",
  "- usable: true se si puo mostrare su una pagina pubblica dell'attivita;",
  "- focus_x, focus_y: dove sta il soggetto, frazioni fra 0 e 1;",
  "- confidence: quanto sei sicuro, fra 0 e 1;",
  "- identifiable_person: true se si riconosce il volto di una persona;",
  "- brand_visible: true se compare un marchio o un'insegna.",
  "",
  "Sii GENEROSO su `usable`: una fotografia ordinaria di un ambiente, di",
  "un dettaglio o di un trattamento e utilizzabile. Metti `false` solo se",
  "e inservibile — sfocata, buia, illeggibile o palesemente estranea",
  "all'attivita. Assegna `hero` a una sola immagine.",
  "",
  "NON descrivere cosa mostra l'immagine. NON dedurre quale trattamento",
  "sia in corso, competenze professionali, nomi di persone, proprieta del",
  "locale, risultati estetici o qualita cliniche. Non trascrivere testo.",
].join("\n");

/**
 * Lo schema della risposta.
 *
 * E la difesa che conta: le altre sono tolleranza, questa e un vincolo.
 * Con `responseSchema` le chiavi, i tipi e i valori di `role` sono
 * quelli e basta — le cinque forme sbagliate che hanno prodotto zero
 * selezioni non possono piu arrivare.
 */
const SCHEMA = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      image_index: { type: SchemaType.INTEGER },
      role: { type: SchemaType.STRING, enum: [...SEQUENZA_RUOLI, "none"] },
      usable: { type: SchemaType.BOOLEAN },
      focus_x: { type: SchemaType.NUMBER },
      focus_y: { type: SchemaType.NUMBER },
      confidence: { type: SchemaType.NUMBER },
      identifiable_person: { type: SchemaType.BOOLEAN },
      brand_visible: { type: SchemaType.BOOLEAN },
    },
    required: [
      "image_index", "role", "usable", "focus_x", "focus_y",
      "confidence", "identifiable_person", "brand_visible",
    ],
  },
} as const;

/** Al massimo dieci immagini per chiamata: oltre, il modello perde il
 *  filo e la spesa cresce senza che la scelta migliori. */
export const MAX_IMMAGINI = 10;

/** Tetto sull'uscita. La risposta e un array di otto campi per
 *  immagine: piu di questo significa che il modello sta scrivendo
 *  prosa, e la prosa e proprio cio che non deve produrre. */
export const MAX_TOKEN_USCITA = 4096;

export async function proponiImpaginazione(
  foto: readonly FotoDaAnalizzare[],
  opts: { modello?: string } = {},
): Promise<Proposta> {
  const t0 = Date.now();
  const modello = opts.modello ?? COMPLEX_MODEL;
  const conti0 = { ...CONTI_VUOTI, images_requested: foto.length, images_downloaded: 0, images_sent: 0 };
  const vuota = (esito: Proposta["esito"]): Proposta => ({
    scelte: [], da_rivedere: [],
    costo: { richieste: foto.length, analizzate: 0, fallite: 0, token: 0, ms: Date.now() - t0 },
    modello, esito, guasto: null,
    analysis_status: "NEEDS_REVIEW", codice: "no_usable_media_selected",
    conti: { ...conti0 },
  });

  if (foto.length === 0) {
    return { ...vuota("nessuna_immagine"), codice: "" };
  }
  if (!gemini) {
    return {
      ...vuota("non_configurato"),
      da_rivedere: tutteDaRivedere(foto),
      guasto: guastoDiConfigurazione(),
      codice: "",
    };
  }

  // IL LOTTO. `image_index` e la posizione QUI DENTRO, e questo array e
  // lo snapshot su cui si traduce la risposta. Non l'indice del
  // manifest: se una fotografia non si scarica, gli indici del manifest
  // diventano non contigui e il modello rinumera per conto suo — che e
  // uno dei modi in cui si perdono tutte le scelte.
  const lotto = foto.slice(0, MAX_IMMAGINI);
  const parti: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [];
  const inviate: FotoDaAnalizzare[] = [];
  let fallite = 0;

  for (const f of lotto) {
    const byte = await f.carica().catch(() => null);
    // Una fotografia che non si scarica resta `unreviewed`: non e stata
    // giudicata inadatta, non e stata giudicata affatto.
    if (!byte || !byte.base64) { fallite++; continue; }
    parti.push({ text: `image_index: ${inviate.length}` });
    parti.push({ inlineData: { data: byte.base64, mimeType: byte.mime } });
    inviate.push(f);
  }

  const conti1 = { ...conti0, images_downloaded: inviate.length, images_sent: inviate.length };

  if (inviate.length === 0) {
    return {
      ...vuota("ok"),
      costo: { richieste: foto.length, analizzate: 0, fallite, token: 0, ms: Date.now() - t0 },
      da_rivedere: tutteDaRivedere(foto),
      conti: conti1,
    };
  }

  let testoRisposta = "";
  let token = 0;
  try {
    const m = gemini.getGenerativeModel({ model: modello, systemInstruction: ISTRUZIONI });
    const r = await m.generateContent({
      contents: [{ role: "user", parts: parti as never }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA as never,
        temperature: 0,
        maxOutputTokens: MAX_TOKEN_USCITA,
      },
    });
    const risposta = r.response as unknown as { usageMetadata?: { totalTokenCount?: number } };
    token = risposta.usageMetadata?.totalTokenCount ?? 0;
    testoRisposta = r.response.text();
  } catch (err) {
    // Il guasto si CLASSIFICA e il testo si butta: un messaggio d'errore
    // di un modello multimodale puo contenere un frammento del contenuto
    // inviato, e l'URL chiamato porta la chiave in query.
    return {
      ...vuota("modello_non_disponibile"),
      da_rivedere: tutteDaRivedere(foto),
      costo: { richieste: foto.length, analizzate: 0, fallite, token: 0, ms: Date.now() - t0 },
      guasto: classificaGuasto(err),
      codice: "",
      conti: conti1,
    };
  }

  const i = interpretaRisposta(testoRisposta, inviate, foto);
  const selezionate = i.conti.selected_count;

  return {
    // La rete: fra il tipo e il disco c'e JSON, che i tipi non li vede.
    scelte: senzaSemantica(i.scelte),
    da_rivedere: i.da_rivedere,
    costo: { richieste: foto.length, analizzate: inviate.length, fallite, token, ms: Date.now() - t0 },
    modello,
    esito: "ok",
    guasto: null,
    // ZERO SELEZIONI NON E UNA PROPOSTA COMPLETATA. La corsa e finita,
    // ha speso, e non ha prodotto niente di impaginabile: e un esito, e
    // va detto con il suo nome invece di somigliare a un successo.
    analysis_status: selezionate > 0 ? "OK" : "NEEDS_REVIEW",
    codice: selezionate > 0 ? "" : "no_usable_media_selected",
    conti: { ...i.conti, ...conti1, selected_count: selezionate, needs_review_count: i.conti.needs_review_count },
  };
}

const tutteDaRivedere = (foto: readonly FotoDaAnalizzare[]) =>
  foto.map((f) => ({ candidate_id: f.candidate_id, motivo: "analisi_non_disponibile" as MotivoRevisione }));

// ----- Interpretazione -------------------------------------------------

export interface Interpretazione {
  scelte: SceltaFoto[];
  da_rivedere: { candidate_id: string; motivo: MotivoRevisione }[];
  conti: ContiInterpretazione;
}

/**
 * Dalla risposta del modello alle scelte di impaginazione.
 *
 * Esportata di proposito: e il punto in cui l'analisi puo fallire in
 * silenzio, e cio che non si puo provare da fuori prima o poi cede —
 * questa funzione e cedura, e nessun test se n'e accorto. Cio che
 * restituisce e pubblico, impaginazione e conteggi, quindi esportarla
 * non apre nessuna strada a un campo semantico: `Osservazione` resta
 * locale e non compare in questa firma.
 *
 * `inviate` e lo SNAPSHOT del lotto: `image_index` si risolve qui
 * dentro e in nessun altro posto. `tutte` serve solo a marcare
 * `unreviewed` le fotografie che non sono nemmeno partite.
 */
export function interpretaRisposta(
  testo: string,
  inviate: readonly FotoDaAnalizzare[],
  tutte: readonly FotoDaAnalizzare[] = inviate,
): Interpretazione {
  const conti: ContiInterpretazione = { ...CONTI_VUOTI };
  const osservazioni = leggiOsservazioni(testo, inviate.length, conti);
  conti.mapped_items = osservazioni.length;

  const { scelte, da_rivedere } = componi(osservazioni, inviate, tutte);
  conti.selected_count = scelte.filter((s) => s.stato === "selected").length;
  conti.needs_review_count = scelte.filter((s) => s.stato === "needs_review").length;
  return { scelte, da_rivedere, conti };
}

/** Le chiavi, in ordine di preferenza. Lo schema dovrebbe rendere
 *  superflui gli alias — ma «dovrebbe» non e una difesa, e costa tre
 *  righe tenerli. */
const CHIAVI = {
  indice: ["image_index", "index", "indice", "idx", "id"],
  ruolo: ["role", "ruolo", "layout_role"],
  adatta: ["usable", "adatta", "suitable", "usabile"],
  fuoco_x: ["focus_x", "fuoco_x", "x"],
  fuoco_y: ["focus_y", "fuoco_y", "y"],
  confidenza: ["confidence", "confidenza", "score"],
  persona: ["identifiable_person", "persona_identificabile", "person", "persona"],
  marchio: ["brand_visible", "marchio_visibile", "brand", "marchio"],
} as const;

const primo = (o: Record<string, unknown>, chiavi: readonly string[]): unknown => {
  for (const k of chiavi) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

/** Ruoli detti in italiano. Con lo schema non dovrebbero arrivare, e
 *  con la prima versione bastavano a cancellare tutte le scelte. */
const RUOLI_ALTERNATIVI: Record<string, RuoloLayout> = {
  apertura: "hero", copertina: "hero", principale: "hero",
  trattamento: "treatment", servizio: "treatment",
  ambiente: "interior", interno: "interior", locale: "interior",
  dettaglio: "detail", particolare: "detail",
  chiusura: "closing", finale: "closing",
};

function leggiOsservazioni(
  testo: string,
  quante: number,
  conti: ContiInterpretazione,
): Osservazione[] {
  let grezzo: unknown;
  try { grezzo = JSON.parse(testo); } catch { conti.parse_failures++; return []; }

  const arr = elencoDa(grezzo);
  if (arr === null) { conti.parse_failures++; return []; }
  conti.model_items_returned = arr.length;

  const out: Osservazione[] = [];
  const visti = new Set<number>();
  for (const x of arr) {
    if (!x || typeof x !== "object") { conti.invalid_indices++; continue; }
    const o = x as Record<string, unknown>;

    // L'indice e un NUMERO confrontato con un intervallo, mai con un
    // hash e mai con un controllo di verita: `0` e un indice valido, ed
    // e proprio quello dell'apertura.
    const n = Number(primo(o, CHIAVI.indice));
    if (!Number.isInteger(n) || n < 0 || n >= quante) { conti.invalid_indices++; continue; }
    if (visti.has(n)) { conti.duplicate_indices++; continue; }
    visti.add(n);

    out.push({
      image_index: n,
      ruolo: ruoloDa(primo(o, CHIAVI.ruolo)),
      fuoco_x: frazione(primo(o, CHIAVI.fuoco_x)) ?? 0.5,
      fuoco_y: frazione(primo(o, CHIAVI.fuoco_y)) ?? 0.5,
      adatta: booleano(primo(o, CHIAVI.adatta)),
      confidenza: frazione(primo(o, CHIAVI.confidenza)),
      persona_identificabile: booleano(primo(o, CHIAVI.persona)) === true,
      marchio_visibile: booleano(primo(o, CHIAVI.marchio)) === true,
    });
  }
  return out;
}

/** L'elenco, da qualunque involucro il modello gli metta intorno.
 *  `null` = non c'era nessun elenco, che e diverso da «elenco vuoto». */
function elencoDa(grezzo: unknown): unknown[] | null {
  if (Array.isArray(grezzo)) return grezzo;
  if (!grezzo || typeof grezzo !== "object") return null;
  // Un solo oggetto, non avvolto: capita, e vale come elenco di uno.
  const o = grezzo as Record<string, unknown>;
  for (const v of Object.values(o)) if (Array.isArray(v)) return v;
  if (primo(o, CHIAVI.indice) !== undefined) return [o];
  return null;
}

function ruoloDa(v: unknown): RuoloLayout | "none" {
  const s = String(v ?? "none").trim().toLowerCase();
  if ((SEQUENZA_RUOLI as readonly string[]).indexOf(s) !== -1) return s as RuoloLayout;
  return RUOLI_ALTERNATIVI[s] ?? "none";
}

/**
 * Una frazione fra 0 e 1, oppure `null`.
 *
 * `null` E IL PUNTO. La versione precedente ripiegava su ZERO, e cosi
 * «non ho saputo leggere la confidenza» diventava «il modello non e per
 * niente sicuro» — cioe il contrario. Un valore non letto non e un
 * valore basso, e chi lo riceve deve poter distinguere le due cose.
 *
 * Le percentuali si convertono: un modello che risponde 90 invece di
 * 0.9 sta dicendo la stessa cosa in un'altra unita.
 */
export function frazione(v: unknown): number | null {
  // `Number("")`, `Number(null)` e `Number([])` valgono tutti ZERO, che
  // e il modo piu silenzioso di trasformare «non l'ha detto» in «ha
  // detto zero». Si filtra prima di convertire.
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return n;
  if (n > 1 && n <= 100) return n / 100;
  return null;
}

/** Un booleano, o `null` se non si capisce. `"si"`, `"true"` e `1` sono
 *  tutti modi di dire di si, e scartarli e costato dieci fotografie. */
export function booleano(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (["true", "si", "sì", "yes", "y", "1", "vero"].indexOf(s) !== -1) return true;
  if (["false", "no", "n", "0", "falso"].indexOf(s) !== -1) return false;
  return null;
}

/** Sotto questa confidenza DICHIARATA la decisione passa a una persona.
 *  Una confidenza non dichiarata non ci arriva mai. */
export const SOGLIA_CONFIDENZA = 0.6;

function componi(
  oss: readonly Osservazione[],
  inviate: readonly FotoDaAnalizzare[],
  tutte: readonly FotoDaAnalizzare[],
): { scelte: SceltaFoto[]; da_rivedere: { candidate_id: string; motivo: MotivoRevisione }[] } {
  const da_rivedere: { candidate_id: string; motivo: MotivoRevisione }[] = [];
  const scelte: SceltaFoto[] = [];

  // LA TRADUZIONE, in un punto solo: image_index -> snapshot del lotto
  // -> candidate_id. Il modello non ha mai visto un candidate_id e non
  // puo averne restituito uno.
  const visti = new Set(oss.map((o) => inviate[o.image_index]?.candidate_id).filter(Boolean));

  // Cio che non e nemmeno partito, o che il modello non ha nominato,
  // resta `unreviewed`: non e stato giudicato inadatto, non e stato
  // giudicato affatto.
  for (const f of tutte) {
    if (visti.has(f.candidate_id)) continue;
    scelte.push(sceltaNeutra(f.candidate_id, "unreviewed"));
    da_rivedere.push({ candidate_id: f.candidate_id, motivo: "analisi_non_disponibile" });
  }

  // L'ordine e per confidenza dichiarata; chi non l'ha dichiarata sta
  // in mezzo, non in fondo — non dichiararla non e un demerito.
  const NEUTRA = SOGLIA_CONFIDENZA;
  const candidate = oss.slice().sort((a, b) => (b.confidenza ?? NEUTRA) - (a.confidenza ?? NEUTRA));

  const ammesse: { id: string; o: Osservazione }[] = [];
  for (const o of candidate) {
    const id = inviate[o.image_index]?.candidate_id;
    if (!id) continue;
    const motivo = motivoRevisione(o);
    if (motivo) {
      scelte.push(sceltaNeutra(id, "needs_review"));
      da_rivedere.push({ candidate_id: id, motivo });
      continue;
    }
    // `adatta === false` e un giudizio; `null` e il suo silenzio. Un
    // silenzio non esclude: se ha dato un ruolo, la vuole in pagina.
    if (o.adatta === false || o.ruolo === "none") {
      scelte.push(sceltaNeutra(id, "not_selected"));
      continue;
    }
    ammesse.push({ id, o });
  }

  // IL RUOLO PROPOSTO SI RISPETTA. La versione precedente lo leggeva e
  // poi lo buttava, assegnando i ruoli per posizione in classifica: il
  // modello diceva «ambiente» e la fotografia diventava l'apertura.
  //
  // L'apertura e una sola: la prima che la chiede, per confidenza. Se
  // nessuna la chiede, la prende la piu sicura fra le ammesse — che e
  // la classifica del modello, non la dimensione del file ne l'ordine
  // in cui Places ce le ha date.
  const inPagina = ammesse.slice(0, MAX_IN_PAGINA);
  for (const x of ammesse.slice(MAX_IN_PAGINA)) {
    scelte.push(sceltaNeutra(x.id, "not_selected"));
  }

  let apertura = inPagina.findIndex((x) => x.o.ruolo === "hero");
  if (apertura === -1 && inPagina.length > 0) apertura = 0;

  const usati = new Set<RuoloLayout>();
  inPagina.forEach((x, i) => {
    let ruolo: RuoloLayout;
    if (i === apertura) ruolo = "hero";
    else if (x.o.ruolo !== "none" && x.o.ruolo !== "hero" && !usati.has(x.o.ruolo)) ruolo = x.o.ruolo;
    else ruolo = SEQUENZA_RUOLI.find((r) => r !== "hero" && !usati.has(r)) ?? "detail";
    usati.add(ruolo);
    scelte.push({
      candidate_id: x.id,
      // L'apertura va in testa: un'apertura in terza posizione non e
      // un'apertura.
      order: i === apertura ? 0 : i < apertura ? i + 1 : i,
      layout_role: ruolo,
      object_position: `${Math.round(x.o.fuoco_x * 100)}% ${Math.round(x.o.fuoco_y * 100)}%`,
      stato: "selected",
    });
  });

  return { scelte, da_rivedere };
}

function motivoRevisione(o: Osservazione): MotivoRevisione | "" {
  // SOLO una confidenza DICHIARATA e bassa manda a una persona. Se il
  // modello non l'ha detta, non l'ha detta: trattarla come zero e cio
  // che ha spedito dieci fotografie buone in revisione.
  if (o.confidenza !== null && o.confidenza < SOGLIA_CONFIDENZA) return "bassa_confidenza";
  if (o.persona_identificabile) return "possibile_persona_identificabile";
  // Un marchio visto in una fotografia Places non si conferma e non si
  // conserva: e un segnale per cercarlo altrove, e lo guarda una
  // persona.
  if (o.marchio_visibile) return "possibile_marchio";
  return "";
}

const sceltaNeutra = (candidate_id: string, stato: SceltaFoto["stato"]): SceltaFoto => ({
  candidate_id, order: 999, layout_role: "detail",
  object_position: RITAGLIO_PREDEFINITO, stato,
});

/** Per il materiale del cliente il regime e l'altro: li la semantica si
 *  puo conservare. Questa funzione esiste per rendere esplicito che il
 *  modulo effimero NON e la strada giusta per quel materiale. */
export function richiedeRegimeEffimero(r: RightsStatus): boolean {
  return !puoPersistereSemantica(r);
}
