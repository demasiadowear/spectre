import type { Page, Response } from "playwright-core";
import type { AsteRawLot } from "@/types/intent";

// ============================================================
// Scraper aste giudiziarie — Tribunale di Bari (provincia), su
// astegiudiziarie.it. Il sito è una SPA: l'HTML statico contiene
// solo template mustache ({{inserzione.prezzoBase}}...), quindi
// parsare il DOM grezzo darebbe SEMPRE 0 lotti. Strategia:
//
//   1) API-first: si intercettano le XHR JSON (page.on("response"))
//      durante il caricamento e lo scroll, e si raccolgono gli oggetti
//      "inserzione" (paginazione via scroll inclusa). Più stabile e
//      leggero del DOM.
//   2) Fallback: se nessun JSON inserzioni viene intercettato, si
//      tenta il DOM dopo network idle (ultima spiaggia).
//
// Riusa il browser Playwright del pipeline Intent. Nessun tentativo
// di aggirare protezioni: un blocco anti-bot viene riportato.
//
// Mapping campi (nomi reali dal modello dati del sito):
//   prezzoBase                         -> offerta_minima
//   categoria                          -> tipo immobile
//   comune / provincia / indirizzo     -> localizzazione
//   tribunale + numeroProcedura +
//     annoProcedura + numeroLotto      -> chiave dedup
//   dataInizioGara / dataUdienza       -> data asta
//   dataFineCauzione                   -> termine presentazione offerte (⚠️)
//   valorePerizia/valoreStima (se c'è) -> valore_stima (spesso ASSENTE
//                                         in lista: risparmio_pct resta
//                                         non calcolabile, mai inventato)
// ============================================================

const DEFAULT_LIST_URL = "https://www.astegiudiziarie.it/immobili/provincia-di-bari";

const BLOCK_SIGNALS = [
  "captcha",
  "verifica di non essere un robot",
  "access denied",
  "accesso negato",
  "just a moment",
  "attention required",
  "richiesta bloccata",
];

// Un oggetto è un "lotto/inserzione" se espone almeno una delle chiavi
// firma del modello dati del sito.
function isLotObject(o: unknown): o is Record<string, unknown> {
  if (!o || typeof o !== "object") return false;
  const r = o as Record<string, unknown>;
  return (
    "numeroProcedura" in r ||
    "prezzoBase" in r ||
    "numeroLotto" in r ||
    "dataFineCauzione" in r
  );
}

/** Cerca ricorsivamente array di inserzioni dentro un JSON arbitrario
 *  (l'involucro — data/results/inserzioni — non è noto a priori). */
function harvest(data: unknown, out: Record<string, unknown>[], keys: Set<string>): void {
  const stack: unknown[] = [data];
  let guard = 0;
  while (stack.length && guard++ < 10_000) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      if (cur.some(isLotObject)) {
        for (const it of cur) {
          if (isLotObject(it)) {
            out.push(it);
            for (const k of Object.keys(it)) keys.add(k);
          }
        }
      } else {
        for (const it of cur) if (it && typeof it === "object") stack.push(it);
      }
    } else if (cur && typeof cur === "object") {
      for (const v of Object.values(cur)) if (v && typeof v === "object") stack.push(v);
    }
  }
}

/** Scalare da una lista di chiavi candidate; se il valore è un oggetto
 *  ({nome/descrizione/value}) ne estrae l'etichetta. */
function pickField(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v == null || v === "") continue;
    if (typeof v === "object") {
      const inner = v as Record<string, unknown>;
      const label = inner.nome ?? inner.descrizione ?? inner.value ?? inner.label ?? inner.codice;
      if (label != null && label !== "") return String(label);
      continue;
    }
    return String(v);
  }
  return "";
}

export function mapInserzione(o: Record<string, unknown>): AsteRawLot {
  const nProc = pickField(o, ["numeroProcedura"]);
  const aProc = pickField(o, ["annoProcedura"]);
  const procedura = nProc && aProc ? `${nProc}/${aProc}` : nProc || pickField(o, ["procedura"]);
  const comune = pickField(o, ["comune"]);
  const provincia = pickField(o, ["provincia", "siglaProvincia"]);
  let link = pickField(o, ["url", "urlDettaglio", "permalink", "link", "slug"]);
  if (link && !/^https?:\/\//i.test(link)) {
    link = `https://www.astegiudiziarie.it/${link.replace(/^\/+/, "")}`;
  }
  return {
    tribunale: pickField(o, ["tribunale"]) || "Bari",
    procedura,
    lotto: pickField(o, ["numeroLotto", "lotto"]),
    comune: provincia ? `${comune} (${provincia})` : comune,
    tipo: pickField(o, ["categoria", "tipologia", "tipoImmobile"]),
    mq: pickField(o, ["superficie", "mq", "metriQuadri", "superficieCommerciale"]),
    vani: pickField(o, ["vani", "numeroVani", "locali"]),
    offerta_minima: pickField(o, ["prezzoBase", "prezzoBaseAsta", "prezzo"]),
    // Solo campi ESPLICITAMENTE di perizia/stima (mai prezzoBase/valoreBase).
    valore_stima: pickField(o, ["valorePerizia", "valoreStima", "valoreDiStima", "prezzoPerizia"]),
    data_asta: pickField(o, ["dataInizioGara", "dataVendita", "dataUdienza"]),
    termine_offerte: pickField(o, ["dataFineCauzione", "dataFinePresentazioneOfferte", "terminePresentazioneOfferte"]),
    link,
    raw_text: JSON.stringify(o),
  };
}

export async function scrapeAsteBari(page: Page): Promise<AsteRawLot[]> {
  const url = process.env.ASTE_LIST_URL?.trim() || DEFAULT_LIST_URL;
  const collected: Record<string, unknown>[] = [];
  const seenKeys = new Set<string>();

  // Intercetta le XHR JSON che popolano la lista (registrato PRIMA di
  // goto per non perdere le prime richieste).
  const onResponse = async (res: Response) => {
    try {
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (!ct.includes("json") || !res.ok()) return;
      harvest(await res.json(), collected, seenKeys);
    } catch {
      /* risposta non-JSON / già consumata: si ignora */
    }
  };
  page.on("response", onResponse);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

    // Blocco anti-bot: riportalo, non aggirarlo.
    const bodyText = ((await page.textContent("body").catch(() => "")) ?? "").toLowerCase();
    const title = (await page.title().catch(() => "")).toLowerCase();
    const blocked = BLOCK_SIGNALS.find((s) => bodyText.includes(s) || title.includes(s));
    if (blocked) {
      throw new Error(`aste: pagina di blocco/anti-bot ("${blocked}") su ${url} — non aggirato.`);
    }

    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    // Paginazione: scroll fino in fondo finché arrivano nuove inserzioni
    // (infinite scroll tipico delle SPA). Cap prudente.
    let prev = -1;
    for (let i = 0; i < 15 && collected.length !== prev; i++) {
      prev = collected.length;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(700);
    }
  } finally {
    page.off("response", onResponse);
  }

  // Diagnostica: log dei campi JSON realmente osservati — così la prima
  // run dal vivo rivela se esiste un campo perizia/stima nella lista.
  if (seenKeys.size > 0) {
    console.log(`[aste/scout] campi JSON inserzione osservati: ${Array.from(seenKeys).sort().join(", ")}`);
  }

  if (collected.length === 0) {
    // Nessuna XHR JSON intercettata: la SPA potrebbe aver cambiato
    // endpoint o non aver caricato. Il DOM è mustache (vuoto): niente
    // fallback DOM utile — errore esplicito, mai "0 lotti" silenzioso.
    throw new Error(
      `aste: nessuna inserzione JSON intercettata su ${url} — endpoint API non individuato o pagina cambiata (SPA).`,
    );
  }

  // Dedup grezzo per chiave procedura+lotto già a monte (l'API può
  // ripetere oggetti tra le pagine di scroll).
  const seen = new Set<string>();
  const lots: AsteRawLot[] = [];
  for (const o of collected) {
    const lot = mapInserzione(o);
    const k = `${lot.procedura}|${lot.lotto}|${lot.comune}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    lots.push(lot);
  }
  return lots;
}
