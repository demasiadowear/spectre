import { gemini, COMPLEX_MODEL } from "@/lib/gemini";
import { puoPersistereSemantica, senzaSemantica } from "./policy-media";
import {
  MAX_IN_PAGINA, RITAGLIO_PREDEFINITO, SEQUENZA_RUOLI,
  type CuratelaProgetto, type MotivoRevisione, type RuoloLayout, type SceltaFoto,
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
// impaginazione. Un campo semantico non puo finire nel database
// perche non esiste una variabile, fuori di qui, che possa contenerlo.
//
// Poi c'e `senzaSemantica()` come rete, perche fra un tipo e il disco
// c'e `JSON.stringify`, che i tipi non li vede.
//
// NOTA GIURIDICA: questa modalita NON e dichiarata conforme. E una
// lettura nostra di §3.2.3(c) dei Google Maps Platform ToS in attesa
// di risposta scritta — vedi docs/GOOGLE-MAPS-PHOTO-CLARIFICATION.md.
// ============================================================

/** La risposta del modello. LOCALE di proposito: non si esporta, e
 *  nessuna funzione pubblica la restituisce. */
interface Osservazione {
  indice: number;
  ruolo: RuoloLayout | "none";
  /** 0-1 da sinistra, 0-1 dall'alto: dove sta il soggetto. */
  fuoco_x: number;
  fuoco_y: number;
  adatta: boolean;
  confidenza: number;
  /** Serve a scegliere il motivo di revisione, non si conserva. */
  persona_identificabile: boolean;
  marchio_visibile: boolean;
}

/** Cio che esce. Solo impaginazione. */
export interface Proposta {
  scelte: SceltaFoto[];
  da_rivedere: { indice: number; motivo: MotivoRevisione }[];
  /** Costi, senza contenuto. */
  costo: { richieste: number; analizzate: number; fallite: number; token: number; ms: number };
  modello: string;
  esito: "ok" | "non_configurato" | "nessuna_immagine" | "modello_non_disponibile";
}

export interface FotoDaAnalizzare {
  indice: number;
  rights_status: RightsStatus;
  /** Come recuperare i byte. Il chiamante li prende on demand. */
  carica: () => Promise<{ base64: string; mime: string } | null>;
}

const ISTRUZIONI = [
  "Osservi fotografie di un'attivita commerciale per deciderne l'IMPAGINAZIONE.",
  "Per ogni immagine indica soltanto:",
  "- se e adatta a una pagina pubblica dell'attivita;",
  "- quale ruolo di layout le si addice fra hero, treatment, interior, detail, closing, none;",
  "- dove sta il soggetto principale, come frazioni fuoco_x e fuoco_y fra 0 e 1;",
  "- se compare una persona identificabile;",
  "- se compare un marchio o un'insegna;",
  "- la tua confidenza fra 0 e 1.",
  "",
  "NON descrivere cosa mostra l'immagine. NON dedurre quale trattamento",
  "sia in corso, competenze professionali, nomi di persone, proprieta del",
  "locale, risultati estetici o qualita cliniche. Non trascrivere testo.",
  "Rispondi SOLO con un array JSON, un oggetto per immagine.",
].join("\n");

/** Al massimo dieci immagini per chiamata: oltre, il modello perde il
 *  filo e la spesa cresce senza che la scelta migliori. */
const MAX_IMMAGINI = 10;

export async function proponiImpaginazione(
  foto: readonly FotoDaAnalizzare[],
  opts: { modello?: string } = {},
): Promise<Proposta> {
  const t0 = Date.now();
  const modello = opts.modello ?? COMPLEX_MODEL;
  const vuota = (esito: Proposta["esito"]): Proposta => ({
    scelte: [], da_rivedere: [],
    costo: { richieste: foto.length, analizzate: 0, fallite: 0, token: 0, ms: Date.now() - t0 },
    modello, esito,
  });

  if (foto.length === 0) return vuota("nessuna_immagine");
  if (!gemini) return { ...vuota("non_configurato"), da_rivedere: tutteDaRivedere(foto) };

  const lotto = foto.slice(0, MAX_IMMAGINI);
  const parti: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [];
  const indici: number[] = [];
  let fallite = 0;

  for (const f of lotto) {
    const byte = await f.carica().catch(() => null);
    // Una fotografia che non si scarica resta `unreviewed`: non e stata
    // giudicata inadatta, non e stata giudicata affatto.
    if (!byte) { fallite++; continue; }
    parti.push({ text: `immagine indice ${f.indice}` });
    parti.push({ inlineData: { data: byte.base64, mimeType: byte.mime } });
    indici.push(f.indice);
  }

  if (indici.length === 0) {
    return { ...vuota("ok"), costo: { ...vuota("ok").costo, fallite }, da_rivedere: tutteDaRivedere(foto) };
  }

  let osservazioni: Osservazione[] = [];
  let token = 0;
  try {
    const m = gemini.getGenerativeModel({ model: modello, systemInstruction: ISTRUZIONI });
    const r = await m.generateContent({
      contents: [{ role: "user", parts: parti as never }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });
    const risposta = r.response as unknown as { usageMetadata?: { totalTokenCount?: number } };
    token = risposta.usageMetadata?.totalTokenCount ?? 0;
    osservazioni = leggiOsservazioni(r.response.text(), indici);
  } catch {
    // Nessun dettaglio: un messaggio d'errore di un modello multimodale
    // puo contenere un frammento del contenuto inviato.
    return {
      ...vuota("modello_non_disponibile"),
      da_rivedere: tutteDaRivedere(foto),
      costo: { richieste: foto.length, analizzate: 0, fallite, token: 0, ms: Date.now() - t0 },
    };
  }

  // Output illeggibile: nessuna decisione. Non si ripiega su un
  // ordinamento per dimensione — sarebbe la scelta per proporzione che
  // ha gia prodotto una striscia tagliata al posto di una fotografia.
  if (osservazioni.length === 0) {
    return {
      ...vuota("ok"), da_rivedere: tutteDaRivedere(foto),
      costo: { richieste: foto.length, analizzate: indici.length, fallite, token, ms: Date.now() - t0 },
    };
  }

  const { scelte, da_rivedere } = componi(osservazioni, foto);

  return {
    // La rete: fra il tipo e il disco c'e JSON, che i tipi non li vede.
    scelte: senzaSemantica(scelte),
    da_rivedere,
    costo: { richieste: foto.length, analizzate: indici.length, fallite, token, ms: Date.now() - t0 },
    modello,
    esito: "ok",
  };
}

const tutteDaRivedere = (foto: readonly FotoDaAnalizzare[]) =>
  foto.map((f) => ({ indice: f.indice, motivo: "analisi_non_disponibile" as MotivoRevisione }));

/** Legge la risposta senza fidarsi della forma. Qualunque campo
 *  descrittivo che il modello aggiungesse di sua iniziativa non viene
 *  nemmeno letto: qui si prendono otto campi e basta. */
function leggiOsservazioni(testo: string, ammessi: readonly number[]): Osservazione[] {
  let grezzo: unknown;
  try { grezzo = JSON.parse(testo); } catch { return []; }
  const arr = Array.isArray(grezzo)
    ? grezzo
    : Array.isArray((grezzo as { immagini?: unknown })?.immagini)
      ? (grezzo as { immagini: unknown[] }).immagini
      : [];

  const out: Osservazione[] = [];
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const indice = Number(o.indice);
    if (!Number.isInteger(indice) || ammessi.indexOf(indice) === -1) continue;
    const ruolo = String(o.ruolo ?? "none") as RuoloLayout | "none";
    out.push({
      indice,
      ruolo: (SEQUENZA_RUOLI as readonly string[]).indexOf(ruolo) !== -1 ? ruolo : "none",
      fuoco_x: frazione(o.fuoco_x, 0.5),
      fuoco_y: frazione(o.fuoco_y, 0.5),
      adatta: o.adatta === true,
      confidenza: frazione(o.confidenza, 0),
      persona_identificabile: o.persona_identificabile === true,
      marchio_visibile: o.marchio_visibile === true,
    });
  }
  return out;
}

const frazione = (v: unknown, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : d;
};

/** Sotto questa confidenza la decisione passa a una persona. */
export const SOGLIA_CONFIDENZA = 0.6;

function componi(
  oss: readonly Osservazione[],
  foto: readonly FotoDaAnalizzare[],
): { scelte: SceltaFoto[]; da_rivedere: { indice: number; motivo: MotivoRevisione }[] } {
  const visti = new Set(oss.map((o) => o.indice));
  const da_rivedere: { indice: number; motivo: MotivoRevisione }[] = [];
  const scelte: SceltaFoto[] = [];

  // Cio che il modello non ha nemmeno visto resta `unreviewed`.
  for (const f of foto) {
    if (!visti.has(f.indice)) {
      scelte.push(sceltaNeutra(f.indice, "unreviewed"));
      da_rivedere.push({ indice: f.indice, motivo: "analisi_non_disponibile" });
    }
  }

  const candidate = oss.slice().sort((a, b) => b.confidenza - a.confidenza);
  let posto = 0;

  for (const o of candidate) {
    const motivo = motivoRevisione(o);
    if (motivo) {
      scelte.push(sceltaNeutra(o.indice, "needs_review"));
      da_rivedere.push({ indice: o.indice, motivo });
      continue;
    }
    if (!o.adatta || o.ruolo === "none" || posto >= MAX_IN_PAGINA) {
      scelte.push(sceltaNeutra(o.indice, "not_selected"));
      continue;
    }
    scelte.push({
      indice: o.indice,
      ordine: posto,
      ruolo: SEQUENZA_RUOLI[posto] ?? "detail",
      object_position: `${Math.round(o.fuoco_x * 100)}% ${Math.round(o.fuoco_y * 100)}%`,
      stato: "selected",
    });
    posto++;
  }
  return { scelte, da_rivedere };
}

function motivoRevisione(o: Osservazione): MotivoRevisione | "" {
  if (o.confidenza < SOGLIA_CONFIDENZA) return "bassa_confidenza";
  if (o.persona_identificabile) return "possibile_persona_identificabile";
  // Un marchio visto in una fotografia Places non si conferma e non si
  // conserva: e un segnale per cercarlo altrove, e lo guarda una
  // persona.
  if (o.marchio_visibile) return "possibile_marchio";
  return "";
}

const sceltaNeutra = (indice: number, stato: SceltaFoto["stato"]): SceltaFoto => ({
  indice, ordine: 999, ruolo: "detail",
  object_position: RITAGLIO_PREDEFINITO, stato,
});

/** Per il materiale del cliente il regime e l'altro: li la semantica si
 *  puo conservare. Questa funzione esiste per rendere esplicito che il
 *  modulo effimero NON e la strada giusta per quel materiale. */
export function richiedeRegimeEffimero(r: RightsStatus): boolean {
  return !puoPersistereSemantica(r);
}
