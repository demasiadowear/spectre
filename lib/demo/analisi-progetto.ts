import { ENV_GOOGLE } from "@/lib/collector/capability";
import { urlMediaProvider } from "@/lib/collector/places";
import { leggiDossier } from "@/lib/collector/db";
import { scopriMarchio, type OpzioniScoperta } from "@/lib/collector/brand-esecuzione";
import { rimedioBlocco, usoConsentito, type ContestoBrand } from "@/lib/collector/brand";
import { getProject } from "@/lib/factory/db";
import { briefDaDossier } from "@/lib/factory/brief";
import { fotoMostrabili, riferimentoPerIndice, type FotoDemo } from "./foto";
import {
  manifestRevision, selectionBasisRevision, type CuratelaProgetto,
} from "./curatela";
import {
  MAX_IMMAGINI, proponiImpaginazione, type FotoDaAnalizzare, type Proposta,
} from "./analisi-effimera";
import {
  leggiProposta, rilasciaAnalisi, rivendicaAnalisi, salvaProposta,
  type PropostaSalvata,
} from "./proposte-db";
import type { BrandOverall, MotivoBlocco } from "@/types/dossier";

// ============================================================
// Il comando «Analizza foto e identita».
//
// Una fase sola, che l'operatore lancia da una schermata e che produce
// una PROPOSTA — non una pagina. La pagina arriva dopo, quando qualcuno
// ha guardato la proposta e ha detto di si.
//
// QUATTRO COSE CHE QUESTO MODULO GARANTISCE, E CHE NON SONO OVVIE:
//
//  1. IDEMPOTENZA SUL MANIFEST. Se le fotografie sono le stesse, non si
//     rispende. La chiave non e «ho gia una proposta»: e
//     `manifest_revision`. Una raccolta che RIORDINA le stesse dieci
//     foto produce lo stesso insieme di identita e quindi la stessa
//     revisione — e non ripaga niente.
//
//  2. UNA SOLA ANALISI ALLA VOLTA. Il lucchetto e una UPDATE
//     condizionata sul database, non un flag in memoria: due click
//     ravvicinati su Vercel arrivano a due istanze diverse, che non
//     condividono niente tranne Turso.
//
//  3. TETTI PRIMA DELLA SPESA. Immagini, byte per immagine, token in
//     uscita e durata dello scaricamento. Un tetto controllato dopo e
//     un tetto che si legge nella fattura.
//
//  4. NESSUN OUTREACH. Questo comando non manda niente a nessuno e non
//     tocca lo stage del progetto. Guarda, propone, e si ferma.
// ============================================================

/** Larghezza con cui si scaricano le immagini per l'analisi. Non e la
 *  larghezza con cui si mostrano: al modello serve vedere il soggetto,
 *  non contare i pori. Meno byte, meno token, stessa decisione. */
export const LARGHEZZA_ANALISI = 800;

/** Tetti. Sono qui, tutti insieme, perche un tetto sparso nel codice e
 *  un tetto che non si sa di avere. */
export const TETTI = {
  immagini: MAX_IMMAGINI,
  /** Oltre questo una singola immagine non si manda: non e una
   *  fotografia di un centro estetico, e qualcos'altro. */
  byte_per_immagine: 4 * 1024 * 1024,
  /** Scaricamento complessivo. Oltre, si analizza cio che si ha. */
  scaricamento_ms: 45_000,
} as const;

export type EsitoComando =
  | "completata"
  | "invariata"           // il manifest non e cambiato: non si rispende
  | "nessuna_immagine"    // non c'e niente da guardare, e non e un guasto
  | "gia_in_corso"
  | "bloccata"            // manca configurazione o capacita
  | "dipendenza_fallita"  // un fornitore non ha risposto
  | "progetto_assente"
  | "dossier_assente"
  | "database_non_disponibile";

export interface RisultatoAnalisi {
  esito: EsitoComando;
  blocco: MotivoBlocco;
  /** Il rimedio operativo, senza nomi di variabili e senza valori. */
  rimedio: string;
  proposta: PropostaSalvata | null;
  brand: {
    status: BrandOverall | "";
    uso: string;
    nota: string;
  };
  costo: {
    immagini: number;
    analizzate: number;
    fallite: number;
    token: number;
    pagine: number;
    query: number;
    durata_ms: number;
  };
}

export interface OpzioniComando {
  /** true = si rianalizza anche se il manifest non e cambiato. E una
   *  scelta esplicita dell'operatore, e costa. */
  refresh?: boolean;
  /** Iniettabili per i test: nessuno dei due ha un default di rete
   *  diverso da quello reale. */
  analizza?: typeof proponiImpaginazione;
  marchio?: (ctx: ContestoBrand, o: OpzioniScoperta) => Promise<Awaited<ReturnType<typeof scopriMarchio>>>;
  scarica?: (url: string) => Promise<{ base64: string; mime: string } | null>;
  env?: NodeJS.ProcessEnv;
}

const vuoto = (esito: EsitoComando, blocco: MotivoBlocco = ""): RisultatoAnalisi => ({
  esito, blocco, rimedio: rimedioBlocco(blocco), proposta: null,
  brand: { status: "", uso: "", nota: "" },
  costo: { immagini: 0, analizzate: 0, fallite: 0, token: 0, pagine: 0, query: 0, durata_ms: 0 },
});

export async function analizzaProgetto(
  projectId: string,
  opts: OpzioniComando = {},
): Promise<RisultatoAnalisi> {
  const t0 = Date.now();
  const env = opts.env ?? process.env;

  const progetto = await getProject(projectId);
  if (!progetto) return vuoto("progetto_assente");

  const salvato = await leggiDossier(progetto.lead_id);
  if (!salvato?.dossier) return vuoto("dossier_assente");
  const dossier = salvato.dossier;

  const foto = fotoMostrabili(dossier, progetto.slug, LARGHEZZA_ANALISI);
  const manifest = manifestRevision(foto);

  // 1. Idempotenza. Il confronto e sul manifest, non sull'esistenza
  //    della proposta: e la differenza fra «non e cambiato niente» e
  //    «c'e gia qualcosa», che sono due cose diverse.
  const precedente = await leggiProposta(projectId);
  if (
    !opts.refresh && precedente
    && precedente.curatela.manifest_revision === manifest
    && precedente.curatela.scelte.length > 0
  ) {
    return {
      ...vuoto("invariata"),
      proposta: precedente,
      brand: statoBrand(precedente.brand_status as BrandOverall, precedente.brand_blocco as MotivoBlocco),
      costo: {
        immagini: precedente.costo.immagini, analizzate: 0, fallite: 0,
        token: 0, pagine: 0, query: 0, durata_ms: Date.now() - t0,
      },
    };
  }

  // 2. Il lucchetto. Da qui in poi si spende, quindi da qui in poi ci
  //    puo stare uno solo.
  if (!(await rivendicaAnalisi(projectId, progetto.lead_id))) {
    return { ...vuoto("gia_in_corso"), proposta: precedente };
  }

  try {
    const chiave = (env[ENV_GOOGLE] ?? "").trim();
    const brief = briefDaDossier(dossier);
    const ctx = contestoBrand(dossier, brief);

    // 3. Le fotografie, scaricate on demand e mai conservate.
    const daAnalizzare = costruisciLotto(foto, dossier, chiave, opts.scarica, t0);

    const analizza = opts.analizza ?? proponiImpaginazione;
    const p: Proposta = chiave || opts.scarica
      ? await analizza(daAnalizzare, {})
      : {
        // Senza chiave Places non si scarica niente, e mandare zero
        // immagini al modello sarebbe pagare per non guardare.
        scelte: [], da_rivedere: [],
        costo: { richieste: foto.length, analizzate: 0, fallite: foto.length, token: 0, ms: 0 },
        modello: "", esito: "non_configurato",
        guasto: { esito: "permanent_error", blocco: "configuration_missing" },
      };

    // 4. L'identita visiva. Gira comunque: un blocco sulle fotografie
    //    non e un motivo per non sapere se un logo c'e.
    const cercaMarchio = opts.marchio ?? scopriMarchio;
    const m = await cercaMarchio(ctx, {});

    const curatela: CuratelaProgetto = {
      basis_revision: selectionBasisRevision(p.scelte, foto),
      manifest_revision: manifest,
      // L'analisi non approva: la revisione della composizione resta
      // quella di prima finche una persona non dice di si.
      proposal_revision: precedente?.curatela.proposal_revision ?? "",
      scelte: p.scelte,
      da_rivedere: p.da_rivedere,
      composta_il: new Date().toISOString(),
    };

    // Il blocco delle fotografie ha la precedenza su quello del marchio:
    // e quello che ferma la pagina.
    const blocco: MotivoBlocco =
      p.guasto?.esito === "permanent_error" ? p.guasto.blocco : m.blocco;

    await salvaProposta({
      project_id: projectId,
      lead_id: progetto.lead_id,
      curatela,
      brand_status: m.identita.brand_status,
      brand_blocco: m.blocco,
      costo: {
        immagini: p.costo.analizzate,
        token: p.costo.token + m.costo.token,
        durata_ms: Date.now() - t0,
        modello: p.modello,
      },
      approvata_il: precedente?.approvata_il || undefined,
    });

    const esito: EsitoComando =
      p.guasto?.esito === "permanent_error" ? "bloccata"
      : p.guasto?.esito === "transient_error" ? "dipendenza_fallita"
      : foto.length === 0 ? "nessuna_immagine"
      : m.blocco ? "bloccata"
      : "completata";

    return {
      esito,
      blocco,
      rimedio: rimedioBlocco(blocco),
      proposta: await leggiProposta(projectId),
      brand: statoBrand(m.identita.brand_status, m.blocco),
      costo: {
        immagini: p.costo.richieste,
        analizzate: p.costo.analizzate,
        fallite: p.costo.fallite,
        token: p.costo.token + m.costo.token,
        pagine: m.costo.pagine,
        query: m.costo.query,
        durata_ms: Date.now() - t0,
      },
    };
  } finally {
    // Il lucchetto si molla sempre. Un `finally` mancante qui vuol dire
    // un progetto che resta bloccato cinque minuti per ogni errore.
    await rilasciaAnalisi(projectId);
  }
}

function statoBrand(status: BrandOverall, blocco: MotivoBlocco) {
  const uso = usoConsentito({
    primary_logo: null, alternate_logo: null, favicon: null,
    signage_reference: null, palette_candidates: [], brand_status: status,
    requires_operator_approval: false, candidates: [],
  });
  return {
    status,
    uso: uso.usa,
    nota: blocco ? rimedioBlocco(blocco) : uso.nota,
  };
}

function contestoBrand(
  d: NonNullable<Awaited<ReturnType<typeof leggiDossier>>>["dossier"],
  brief: ReturnType<typeof briefDaDossier>,
): ContestoBrand {
  const nome = brief.nome || "";
  // «di Rosita Buonsante» dentro l'insegna e un ancoraggio fortissimo:
  // un film omonimo non porta mai il nome della titolare.
  const titolare = /\bdi\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ']+)?)/.exec(nome)?.[1] ?? "";
  return {
    nome,
    citta: brief.luogo?.citta || "",
    indirizzo: brief.luogo?.indirizzo || "",
    titolare,
    official_host: d?.official_host || "",
  };
}

/**
 * Il lotto da analizzare.
 *
 * `carica()` e una chiusura, non un byte: le immagini si scaricano una
 * alla volta dentro la funzione di analisi e non restano da nessuna
 * parte. Il riferimento del provider non esce di qui — chi legge
 * `FotoDaAnalizzare` vede un'identita e una funzione.
 */
function costruisciLotto(
  foto: readonly FotoDemo[],
  dossier: Parameters<typeof riferimentoPerIndice>[0],
  chiave: string,
  scarica: OpzioniComando["scarica"],
  t0: number,
): FotoDaAnalizzare[] {
  return foto.slice(0, TETTI.immagini).map((f) => ({
    candidate_id: f.id,
    indice: f.indice,
    rights_status: f.rights_status,
    carica: async () => {
      if (Date.now() - t0 > TETTI.scaricamento_ms) return null;
      const r = riferimentoPerIndice(dossier, String(f.indice));
      if (!r.ok) return null;
      const url = urlMediaProvider(r.riferimento, LARGHEZZA_ANALISI, chiave);
      if (scarica) return scarica(url);
      return scaricaImmagine(url);
    },
  }));
}

async function scaricaImmagine(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    const mime = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\//i.test(mime)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Il tetto si applica DOPO lo scaricamento perche `content-length`
    // manca quasi sempre su una risposta ridiretta. Ma si applica prima
    // dell'invio, che e dove costa.
    if (buf.byteLength > TETTI.byte_per_immagine) return null;
    return { base64: buf.toString("base64"), mime: mime.split(";")[0].trim() };
  } catch {
    // Nessun dettaglio: l'URL porta la chiave in query.
    return null;
  }
}
