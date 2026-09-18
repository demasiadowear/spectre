import { SchemaType } from "@google/generative-ai";
import { gemini, COMPLEX_MODEL } from "@/lib/gemini";
import { classificaGuasto, guastoDiConfigurazione, type Guasto } from "@/lib/collector/guasti";
import { puoPersistereSemantica, senzaSemantica } from "./policy-media";
import {
  MAX_IN_PAGINA, RITAGLIO_PREDEFINITO, SEQUENZA_RUOLI, valutaProposta,
  type CodiceProposta, type MotivoRevisione, type RuoloLayout, type SceltaFoto,
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

  // ----- Asse A: che cos'e, e quanto vale -----
  genere: GenereContenuto;
  /** Quanto regge come immagine di un'attivita che vende. */
  richiamo: number | null;
  /** Quanto e disordinata. Alto = male. */
  disordine: number | null;
  /** Luce e nitidezza insieme. */
  qualita: number | null;
  /** Il soggetto si capisce guardandola? */
  soggetto_leggibile: boolean | null;
  fuoco_x: number;
  fuoco_y: number;
  confidenza: number | null;

  // ----- Asse B: che marchio si vede, e chi si riconosce -----
  marchio: OsservazioneMarchio;
  persona_identificabile: boolean;
}

// NOTA: qui NON c'e `ruolo` e NON c'e `adatta`, e non e una
// semplificazione.
//
// Finche il modello poteva dire «usable: false» o «role: none»,
// poteva CHIUDERE la selezione da solo — e su una corsa reale l'ha
// fatto: ha marcato utilizzabile una fotografia sola, un mucchio di
// asciugamani, e il compositore non ha avuto niente da comporre. Il
// modello OSSERVA; chi decide e il compositore, che vede tutti i
// candidati e risponde a una domanda alla volta.

/**
 * ASSE B — che marchio si vede. NON e una decisione di curatela.
 *
 * Tenerli sullo stesso asse e costato una proposta reale: nove
 * fotografie su dieci escluse perche «forse c'e un marchio», e in
 * pagina e rimasto un mucchio di asciugamani — l'unica immagine che
 * non conteneva niente. Un centro estetico ha confezioni di prodotti su
 * ogni scaffale: se il marchio incidentale esclude, si esclude il
 * mestiere insieme al marchio.
 */
type OsservazioneMarchio =
  /** Niente di riconoscibile. */
  | "none"
  /** Confezioni, flaconi, un logo su un asciugamano: c'e ma non e il
   *  soggetto. NON blocca, e non e nemmeno un motivo da mostrare. */
  | "incidental_mark"
  /** Potrebbe essere l'insegna del cliente. Conta — per la scoperta
   *  del marchio, non per la qualita della fotografia. */
  | "possible_business_mark"
  /** Un marchio altrui che DOMINA l'inquadratura. Questo puo fermarla:
   *  una pagina che porta il nome del cliente non si apre con il logo
   *  di qualcun altro. */
  | "dominant_third_party_mark";

/**
 * ASSE A — che genere di immagine e.
 *
 * Esiste per una ragione sola: rendere il gate dell'apertura
 * DETERMINISTICO. «Non aprire con un mucchio di asciugamani» non si puo
 * affidare a un punteggio, perche un punteggio alto su un mucchio di
 * asciugamani resta un mucchio di asciugamani — ed e successo, con
 * confidenza 0,99.
 */
type GenereContenuto =
  | "treatment"            // un trattamento in corso, composizione leggibile
  | "person_treatment"     // una persona durante un trattamento
  | "interior"             // l'ambiente
  | "detail"               // un dettaglio coerente col benessere
  | "product"              // un prodotto
  | "linen"                // tessili, asciugamani, biancheria
  | "storage"              // deposito, disordine, ripostiglio
  | "ceiling"              // soffitto, o inquadratura fortemente inclinata
  | "equipment_detail"     // un macchinario, spesso tagliato
  | "unidentified_object"  // un oggetto isolato che non si capisce
  | "other";

/**
 * Lo stato dell'ANALISI, distinto da quello della proposta.
 *
 * `NEEDS_REVIEW` non vuol dire che qualcosa si e rotto: vuol dire che
 * il risultato non e utilizzabile com'e e lo deve guardare una persona.
 * Una corsa che analizza dieci fotografie e non ne sceglie nessuna e
 * finita, ma non ha prodotto una proposta.
 */
export type StatoAnalisi = "OK" | "NEEDS_REVIEW";

/**
 * L'apertura e stata trovata?
 *
 * `NEEDS_REVIEW` non e un guasto: e la pagina che si apre con il nome
 * invece che con una fotografia che non merita quel posto. Nessuna
 * immagine viene promossa automaticamente — meglio una hero testuale
 * progettata che il mucchio di asciugamani.
 */
export type StatoHero = "OK" | "NEEDS_REVIEW";

/** La regola sta in `lib/demo/curatela.ts`, in un posto solo: qui si
 *  ri-esporta il tipo per comodita di chi legge questo modulo. */
export type { CodiceProposta } from "./curatela";

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
  /** L'apertura c'e, oppure la pagina si apre con il nome. */
  hero_status: StatoHero;
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

const GENERI = [
  "treatment", "person_treatment", "interior", "detail", "product",
  "linen", "storage", "ceiling", "equipment_detail", "unidentified_object", "other",
] as const;

const MARCHI = [
  "none", "incidental_mark", "possible_business_mark", "dominant_third_party_mark",
] as const;

const ISTRUZIONI = [
  "Osservi fotografie di un'attivita commerciale e ne DESCRIVI le",
  "caratteristiche. NON decidere quali usare: quella scelta la fa",
  "un'altra parte del sistema, che le vede tutte insieme.",
  "",
  "Ogni immagine e preceduta da una riga «image_index: N». Usa QUEL",
  "numero. Rispondi per OGNI immagine ricevuta, anche per quelle che ti",
  "sembrano brutte: servono anche quelle.",
  "",
  "Per ogni immagine restituisci:",
  "- image_index: il numero della riga che precede l'immagine;",
  "- content_kind: che cosa e, fra",
  "  treatment (un trattamento in corso, composizione leggibile),",
  "  person_treatment (una persona durante un trattamento),",
  "  interior (l'ambiente, la sala, la postazione),",
  "  detail (un dettaglio coerente col benessere),",
  "  product (un prodotto o una confezione come soggetto),",
  "  linen (tessili, asciugamani, biancheria, teli — ammassati o piegati),",
  "  storage (deposito, scaffali di servizio, disordine, ripostiglio),",
  "  ceiling (soffitto, faretti, o inquadratura fortemente inclinata verso l'alto),",
  "  equipment_detail (un macchinario o un lettino, spesso tagliato),",
  "  unidentified_object (un oggetto isolato che non si capisce),",
  "  other;",
  "- commercial_appeal 0-1: quanto regge come immagine di un'attivita che vende;",
  "- clutter 0-1: quanto e disordinata o affollata (alto = disordinata);",
  "- quality 0-1: luce e nitidezza insieme;",
  "- subject_legible: true se il soggetto si capisce guardandola;",
  "- focus_x, focus_y 0-1: dove sta il soggetto;",
  "- confidence 0-1: quanto sei sicuro di questa descrizione;",
  "- identifiable_person: true se si riconosce il volto di una persona;",
  "- brand_observation: none se non si vede nessun marchio;",
  "  incidental_mark se se ne vede uno ma NON e il soggetto (confezioni",
  "  su uno scaffale, un logo su un flacone o su un asciugamano);",
  "  possible_business_mark se potrebbe essere l'insegna di QUESTA attivita;",
  "  dominant_third_party_mark se un marchio altrui DOMINA l'inquadratura.",
  "",
  "Sii preciso su content_kind: un mucchio di asciugamani e `linen`",
  "anche se sta dentro una sala, e una foto verso i faretti e `ceiling`",
  "anche se si intravede l'ambiente. E la descrizione che conta di piu.",
  "",
  "NON descrivere a parole cosa mostra l'immagine, non trascrivere",
  "testo, non nominare marchi, non dedurre quale trattamento sia in",
  "corso, competenze professionali, nomi di persone, proprieta del",
  "locale, risultati estetici o qualita cliniche. Rispondi solo con i",
  "campi elencati.",
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
      content_kind: { type: SchemaType.STRING, enum: [...GENERI] },
      commercial_appeal: { type: SchemaType.NUMBER },
      clutter: { type: SchemaType.NUMBER },
      quality: { type: SchemaType.NUMBER },
      subject_legible: { type: SchemaType.BOOLEAN },
      focus_x: { type: SchemaType.NUMBER },
      focus_y: { type: SchemaType.NUMBER },
      confidence: { type: SchemaType.NUMBER },
      identifiable_person: { type: SchemaType.BOOLEAN },
      brand_observation: { type: SchemaType.STRING, enum: [...MARCHI] },
    },
    // `usable` e `role` NON sono nello schema, e non e una dimenticanza:
    // il modello non ha piu un campo con cui chiudere la selezione.
    required: [
      "image_index", "content_kind", "commercial_appeal", "clutter",
      "quality", "subject_legible", "focus_x", "focus_y", "confidence",
      "identifiable_person", "brand_observation",
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
    analysis_status: "NEEDS_REVIEW", hero_status: "NEEDS_REVIEW",
    codice: "no_usable_media_selected",
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

  // MENO DI DUE SCELTE SU ALMENO CINQUE DISPONIBILI non e una pagina.
  // Puo essere vero — dieci fotografie inservibili capitano — ma non e
  // un risultato di cui fidarsi senza guardare, e la differenza fra
  // «va bene cosi» e «guarda tu» la deve dire il sistema.
  const v = valutaProposta(i.scelte);
  const codice: CodiceProposta = v.codice;

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
    // L'analisi e «OK» solo se ha prodotto abbastanza da poterci
    // lavorare. Un'apertura mancante da sola non la declassa: la pagina
    // si apre con il nome, ed e una composizione legittima.
    analysis_status: v.proposal_status === "complete" ? "OK" : "NEEDS_REVIEW",
    hero_status: i.hero_status,
    codice,
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
  hero_status: StatoHero;
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

  const { scelte, da_rivedere, hero_status } = componi(osservazioni, inviate, tutte);
  conti.selected_count = scelte.filter((s) => s.stato === "selected").length;
  conti.needs_review_count = scelte.filter((s) => s.stato === "needs_visual_review").length;
  return { scelte, da_rivedere, conti, hero_status };
}

/** Le chiavi, in ordine di preferenza. Lo schema dovrebbe rendere
 *  superflui gli alias — ma «dovrebbe» non e una difesa, e costa tre
 *  righe tenerli. */
const CHIAVI = {
  indice: ["image_index", "index", "indice", "idx", "id"],
  genere: ["content_kind", "genere", "kind", "category"],
  fuoco_x: ["focus_x", "fuoco_x", "x"],
  fuoco_y: ["focus_y", "fuoco_y", "y"],
  confidenza: ["confidence", "confidenza", "score"],
  richiamo: ["commercial_appeal", "richiamo", "appeal"],
  disordine: ["clutter", "disordine", "clutter_score"],
  qualita: ["quality", "qualita", "quality_score"],
  leggibile: ["subject_legible", "soggetto_leggibile", "legible"],
  marchio: ["brand_observation", "marchio", "brand"],
  /** La forma vecchia: un booleano «c'e un marchio». Si legge per non
   *  perdere il segnale, ma da sola non basta piu a fermare niente. */
  marchio_legacy: ["brand_visible", "marchio_visibile"],
  persona: ["identifiable_person", "persona_identificabile", "person", "persona"],
} as const;

const primo = (o: Record<string, unknown>, chiavi: readonly string[]): unknown => {
  for (const k of chiavi) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
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
      genere: generoDa(primo(o, CHIAVI.genere)),
      fuoco_x: frazione(primo(o, CHIAVI.fuoco_x)) ?? 0.5,
      fuoco_y: frazione(primo(o, CHIAVI.fuoco_y)) ?? 0.5,
      confidenza: frazione(primo(o, CHIAVI.confidenza)),
      richiamo: frazione(primo(o, CHIAVI.richiamo)),
      disordine: frazione(primo(o, CHIAVI.disordine)),
      qualita: frazione(primo(o, CHIAVI.qualita)),
      soggetto_leggibile: booleano(primo(o, CHIAVI.leggibile)),
      marchio: marchioDa(primo(o, CHIAVI.marchio), booleano(primo(o, CHIAVI.marchio_legacy))),
      persona_identificabile: booleano(primo(o, CHIAVI.persona)) === true,
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

/**
 * Da che cosa E la fotografia a dove va in pagina.
 *
 * Il ruolo non lo chiede piu nessuno al modello: si deriva dal genere,
 * che e un'osservazione. Cosi la stessa descrizione produce sempre la
 * stessa impaginazione, e non c'e un campo con cui il modello possa
 * decidere l'ordine della pagina.
 */
function ruoloDaGenere(g: GenereContenuto): RuoloLayout {
  switch (g) {
    case "treatment": case "person_treatment": return "treatment";
    case "interior": return "interior";
    case "detail": case "product": return "detail";
    default: return "closing";
  }
}

/** Il genere di contenuto. Sconosciuto = `other`: non si indovina, e
 *  `other` non e ne premiato ne punito. */
function generoDa(v: unknown): GenereContenuto {
  const x = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (GENERI as readonly string[]).indexOf(x) !== -1 ? (x as GenereContenuto) : "other";
}

/**
 * L'osservazione sul marchio.
 *
 * `legacy` e il vecchio booleano «c'e un marchio». Quando arriva solo
 * quello, un marchio vale INCIDENTALE e non ferma niente: e la
 * conversione che impedisce al difetto di tornare da una risposta
 * vecchio stile.
 */
function marchioDa(v: unknown, legacy: boolean | null): OsservazioneMarchio {
  const x = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((MARCHI as readonly string[]).indexOf(x) !== -1) return x as OsservazioneMarchio;
  return legacy === true ? "incidental_mark" : "none";
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

/** Sotto questa confidenza DICHIARATA la descrizione non si usa da
 *  sola: la guarda una persona. Una confidenza non dichiarata non ci
 *  arriva mai. */
export const SOGLIA_CONFIDENZA = 0.6;

/**
 * GENERI CHE NON VANNO IN PAGINA. Esclusione automatica, causa
 * esplicita.
 *
 * Sono i tre che una corsa reale ha mostrato: un mucchio di asciugamani
 * in apertura, e una fotografia verso i faretti. Non e un giudizio di
 * gusto, e un fatto sul soggetto: nessun sito di nessun centro estetico
 * mostra la biancheria sporca o il soffitto.
 *
 * `equipment_detail`, `unidentified_object` e `product` NON sono qui:
 * possono stare in galleria — un macchinario e un dettaglio del
 * mestiere — ma non aprono. Vedi `GENERI_AMMESSI_HERO`.
 */
const GENERI_ESCLUSI: readonly GenereContenuto[] = ["linen", "storage", "ceiling"];

/** Sotto questa qualita dichiarata la fotografia non si mostra. */
const QUALITA_MINIMA = 0.35;

/**
 * IL GATE DELL'APERTURA. Deterministico, severo, e per PROVE POSITIVE.
 *
 * La versione precedente escludeva sui difetti: se il modello non
 * dichiarava il disordine, il disordine non c'era. Cosi una fotografia
 * descritta male passava. Adesso ogni condizione va DIMOSTRATA: un
 * valore non dichiarato non e un valore buono, e l'apertura non si
 * prende per mancanza di obiezioni.
 *
 * Il gate ferma il programma, non chi guarda: se l'operatore mette in
 * apertura quella fotografia, e una sua decisione e vale.
 */
export const SOGLIE_HERO = {
  richiamo: 0.65,
  disordine_max: 0.35,
  qualita: 0.6,
  /** Il soggetto deve stare abbastanza dentro l'inquadratura da
   *  sopravvivere sia al 16:9 del desktop sia al 3:4 del telefono. */
  fuoco_min: 0.2,
  fuoco_max: 0.8,
} as const;

/** Solo questi generi possono aprire, ed e un elenco POSITIVO: cio che
 *  non e nominato non apre, compreso `other`. */
const GENERI_AMMESSI_HERO: readonly GenereContenuto[] = [
  "treatment", "person_treatment", "interior", "detail",
];

export type MotivoNoHero =
  | "" | "genere_non_ammesso" | "disordine_alto" | "richiamo_basso"
  | "qualita_bassa" | "soggetto_illeggibile" | "ritaglio_insostenibile"
  | "non_dichiarato" | "unica_selezionata";

function gateHero(o: Osservazione): MotivoNoHero {
  if (GENERI_AMMESSI_HERO.indexOf(o.genere) === -1) return "genere_non_ammesso";
  if (o.soggetto_leggibile !== true) return "soggetto_illeggibile";
  // PROVE POSITIVE: `null` non passa. Non sapere non e un merito.
  if (o.richiamo === null || o.disordine === null || o.qualita === null) return "non_dichiarato";
  if (o.disordine > SOGLIE_HERO.disordine_max) return "disordine_alto";
  if (o.qualita < SOGLIE_HERO.qualita) return "qualita_bassa";
  if (o.richiamo < SOGLIE_HERO.richiamo) return "richiamo_basso";
  const dentro = (v: number) => v >= SOGLIE_HERO.fuoco_min && v <= SOGLIE_HERO.fuoco_max;
  if (!dentro(o.fuoco_x) || !dentro(o.fuoco_y)) return "ritaglio_insostenibile";
  return "";
}

/**
 * La curatela di una singola fotografia.
 *
 * ESCLUSIONE AUTOMATICA SOLO PER CAUSE ESPLICITE. Non c'e piu nessun
 * modo per cui una fotografia esca dalla proposta senza che si possa
 * dire quale fatto l'ha fatta uscire — ed e la regola che mancava:
 * prima bastava che il modello non la selezionasse.
 */
function decidi(o: Osservazione): { stato: SceltaFoto["stato"]; motivo: MotivoRevisione | "" } {
  // --- Cause esplicite di esclusione ---
  if (GENERI_ESCLUSI.indexOf(o.genere) !== -1) {
    return { stato: "not_selected", motivo: "genere_non_utilizzabile" };
  }
  if (o.soggetto_leggibile === false) {
    return { stato: "not_selected", motivo: "qualita_insufficiente" };
  }
  if (o.qualita !== null && o.qualita < QUALITA_MINIMA) {
    return { stato: "not_selected", motivo: "qualita_insufficiente" };
  }

  // --- Cause esplicite di revisione: si guarda, non si butta ---
  if (o.marchio === "dominant_third_party_mark") {
    return { stato: "needs_visual_review", motivo: "marchio_estraneo_dominante" };
  }
  // UNA PERSONA RICONOSCIBILE NON E UN CONSENSO ACQUISITO. Resta in
  // revisione: l'operatore puo metterla in pagina, ma e una decisione
  // che deve prendere guardandola, non un effetto collaterale.
  if (o.persona_identificabile) {
    return { stato: "needs_visual_review", motivo: "possibile_persona_identificabile" };
  }
  if (o.confidenza !== null && o.confidenza < SOGLIA_CONFIDENZA) {
    return { stato: "needs_visual_review", motivo: "bassa_confidenza" };
  }

  // --- Segnala e passa: il marchio incidentale non e nemmeno qui ---
  if (o.marchio === "possible_business_mark") {
    return { stato: "selected", motivo: "marchio_attivita_possibile" };
  }
  return { stato: "selected", motivo: "" };
}

const sceltaNeutra = (candidate_id: string, stato: SceltaFoto["stato"]): SceltaFoto => ({
  candidate_id, order: 999, layout_role: "detail",
  object_position: RITAGLIO_PREDEFINITO, stato,
});

/** L'ordine di preferenza in galleria, dopo l'apertura. */
const RANGO_GENERE: readonly GenereContenuto[] = [
  "treatment", "interior", "detail", "person_treatment",
  "product", "equipment_detail", "unidentified_object", "other",
];

/**
 * Da osservazioni a composizione. IL COMPOSITORE VEDE TUTTI.
 *
 * Nessuna fotografia scaricata resta fuori dalla valutazione: se il
 * modello l'ha descritta, il compositore la giudica. La descrizione dice
 * com'e; la decisione la prende qui, e una sola volta.
 */
function componi(
  oss: readonly Osservazione[],
  inviate: readonly FotoDaAnalizzare[],
  tutte: readonly FotoDaAnalizzare[],
): {
  scelte: SceltaFoto[];
  da_rivedere: { candidate_id: string; motivo: MotivoRevisione }[];
  hero_status: StatoHero;
} {
  const da_rivedere: { candidate_id: string; motivo: MotivoRevisione }[] = [];
  const scelte: SceltaFoto[] = [];

  // image_index -> snapshot del lotto -> candidate_id, in un punto solo.
  const visti = new Set(oss.map((o) => inviate[o.image_index]?.candidate_id).filter(Boolean));
  for (const f of tutte) {
    if (visti.has(f.candidate_id)) continue;
    scelte.push(sceltaNeutra(f.candidate_id, "unreviewed"));
    da_rivedere.push({ candidate_id: f.candidate_id, motivo: "analisi_non_disponibile" });
  }

  const ammesse: { id: string; o: Osservazione }[] = [];
  for (const o of oss) {
    const id = inviate[o.image_index]?.candidate_id;
    if (!id) continue;
    const d = decidi(o);
    // Il motivo arriva all'operatore anche per le sole non selezionate:
    // «non in pagina» senza un perche costringe a indovinare.
    if (d.motivo) da_rivedere.push({ candidate_id: id, motivo: d.motivo });
    if (d.stato !== "selected") { scelte.push(sceltaNeutra(id, d.stato)); continue; }
    ammesse.push({ id, o });
  }

  // ----- La galleria: 3-5, per merito -----
  const ordinate = ammesse.slice().sort((a, b) => {
    const ra = RANGO_GENERE.indexOf(a.o.genere);
    const rb = RANGO_GENERE.indexOf(b.o.genere);
    if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
    return (b.o.richiamo ?? 0) - (a.o.richiamo ?? 0);
  });
  const inPagina = ordinate.slice(0, MAX_IN_PAGINA);
  for (const x of ordinate.slice(MAX_IN_PAGINA)) scelte.push(sceltaNeutra(x.id, "not_selected"));

  // ----- L'apertura -----
  //
  // MAI PROMUOVERE L'UNICA SELEZIONATA. Una fotografia sola non e una
  // pagina, e metterla in apertura la fa sembrare una scelta quando e
  // solo cio che e avanzato.
  const idonee = inPagina
    .filter((x) => gateHero(x.o) === "")
    .sort((a, b) => {
      const ra = GENERI_AMMESSI_HERO.indexOf(a.o.genere);
      const rb = GENERI_AMMESSI_HERO.indexOf(b.o.genere);
      if (ra !== rb) return ra - rb;
      return (b.o.richiamo ?? 0) - (a.o.richiamo ?? 0);
    });
  const apertura = inPagina.length >= 2 ? (idonee[0] ?? null) : null;
  const hero_status: StatoHero = apertura ? "OK" : "NEEDS_REVIEW";

  const sequenza = apertura
    ? [apertura].concat(inPagina.filter((x) => x.id !== apertura.id))
    : inPagina;

  const usati = new Set<RuoloLayout>();
  sequenza.forEach((x, i) => {
    let ruolo: RuoloLayout;
    if (apertura && x.id === apertura.id) ruolo = "hero";
    else {
      const proposto = ruoloDaGenere(x.o.genere);
      ruolo = !usati.has(proposto) && proposto !== "hero"
        ? proposto
        : SEQUENZA_RUOLI.find((r) => r !== "hero" && !usati.has(r)) ?? "detail";
    }
    usati.add(ruolo);
    scelte.push({
      candidate_id: x.id,
      order: i,
      layout_role: ruolo,
      object_position: `${Math.round(x.o.fuoco_x * 100)}% ${Math.round(x.o.fuoco_y * 100)}%`,
      stato: "selected",
    });
  });

  return { scelte, da_rivedere, hero_status };
}

/** Per il materiale del cliente il regime e l'altro: li la semantica si
 *  puo conservare. Questa funzione esiste per rendere esplicito che il
 *  modulo effimero NON e la strada giusta per quel materiale. */
export function richiedeRegimeEffimero(r: RightsStatus): boolean {
  return !puoPersistereSemantica(r);
}
