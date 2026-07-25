import type { Page } from "playwright-core";
import type { AsteRawLot } from "@/types/intent";

// ============================================================
// Scraper aste giudiziarie — pagina Tribunale di Bari, immobili
// residenziali, su astegiudiziarie.it. Sorgente aggiuntiva dello
// Scout: riusa il browser Playwright del pipeline Intent.
//
// STRATEGIA (robusta ai cambi di layout): identifica le "schede
// lotto" con un selettore di contenitore, e per ogni scheda cattura
// il TESTO INTEGRALE (raw_text) + il link. I singoli campi (comune,
// prezzi, date, procedura, lotto) vengono poi estratti a valle con
// regex su raw_text (lib/intent/aste.ts), molto meno fragile dei
// selettori interni.
//
// ⚠️ DA VALIDARE DAL VIVO: l'URL e i selettori container/link sono
// impostati sui pattern noti di astegiudiziarie.it ma NON verificati
// sul DOM reale (la fonte è irraggiungibile dall'ambiente di build).
// Override senza toccare il codice:
//   ASTE_LIST_URL       — URL lista Tribunale Bari (residenziale)
//   ASTE_CARD_SELECTOR  — selettore CSS della scheda lotto
// Se il DOM non combacia, lo scraper lancia un errore esplicito
// (mai uno "0 lotti" silenzioso) e la run lo riporta.
// ============================================================

const DEFAULT_LIST_URL =
  "https://www.astegiudiziarie.it/Immobili/Vendite?IdTribunale=Bari&Categoria=Residenziale";

// Candidati di selettore per la scheda lotto (si prova il primo che
// trova nodi). L'override ASTE_CARD_SELECTOR ha priorità.
const CARD_SELECTOR_CANDIDATES = [
  ".scheda-lotto",
  ".lotto",
  ".card-lotto",
  "[class*='lotto']",
  "article",
  ".risultato",
];

// Segnali di pagina anti-bot / blocco (non si aggira: si riporta).
const BLOCK_SIGNALS = [
  "captcha",
  "verifica di non essere un robot",
  "access denied",
  "accesso negato",
  "just a moment",
  "attention required",
  "cloudflare",
  "richiesta bloccata",
];

export async function scrapeAsteBari(page: Page): Promise<AsteRawLot[]> {
  const url = process.env.ASTE_LIST_URL?.trim() || DEFAULT_LIST_URL;
  const overrideSel = process.env.ASTE_CARD_SELECTOR?.trim();

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  // Blocco anti-bot: riportalo esplicitamente, non aggirarlo.
  const bodyText = ((await page.textContent("body").catch(() => "")) ?? "").toLowerCase();
  const title = (await page.title().catch(() => "")).toLowerCase();
  const blocked = BLOCK_SIGNALS.find((s) => bodyText.includes(s) || title.includes(s));
  if (blocked) {
    throw new Error(
      `aste: pagina di blocco/anti-bot rilevata ("${blocked}") su ${url} — non aggirato, da gestire manualmente.`,
    );
  }

  // Trova un selettore di scheda che matchi davvero dei nodi.
  const selectors = overrideSel ? [overrideSel] : CARD_SELECTOR_CANDIDATES;
  let cardSelector = "";
  for (const sel of selectors) {
    const n = await page.locator(sel).count().catch(() => 0);
    if (n > 0) {
      cardSelector = sel;
      break;
    }
  }
  if (!cardSelector) {
    throw new Error(
      `aste: nessuna scheda lotto trovata su ${url} (selettori provati: ${selectors.join(", ")}) — layout diverso dal previsto, imposta ASTE_CARD_SELECTOR.`,
    );
  }

  const lots = await page.evaluate((sel: string) => {
    const cards = Array.from(document.querySelectorAll(sel));
    return cards.map((card) => {
      const text = (card as HTMLElement).innerText?.replace(/\s+\n/g, "\n").trim() ?? "";
      // Link avviso/perizia: preferisci un anchor che punti a PDF/avviso/perizia.
      const anchors = Array.from(card.querySelectorAll<HTMLAnchorElement>("a[href]"));
      const preferred =
        anchors.find((a) => /perizia|avviso|dettaglio|scheda|\.pdf/i.test(a.href)) ??
        anchors.find((a) => a.href && a.href.startsWith("http"));
      return { text, link: preferred?.href ?? "" };
    });
  }, cardSelector);

  // Schede trovate ma nessuna con testo utile = DOM interno cambiato:
  // errore esplicito (indistinguibile altrimenti da un giorno vuoto).
  const usable = lots.filter((l) => l.text && l.text.length > 20);
  if (lots.length > 0 && usable.length === 0) {
    throw new Error(
      `aste: ${lots.length} schede trovate ma 0 con testo estraibile — struttura interna cambiata.`,
    );
  }

  // Ogni scheda diventa un AsteRawLot con i campi lasciati vuoti: il
  // parsing regex a valle (parseAsteLot) li ricava da raw_text.
  return usable.map((l) => ({
    tribunale: "Bari",
    procedura: "",
    lotto: "",
    comune: "",
    tipo: "",
    mq: "",
    vani: "",
    offerta_minima: "",
    valore_stima: "",
    data_asta: "",
    termine_offerte: "",
    link: l.link,
    raw_text: l.text,
  }));
}
