import type { Page } from "playwright-core";
import type { RawIntentRequest } from "@/types/intent";

// ============================================================
// Scraper AddLance — lista pubblica https://www.addlance.com/lavoro-freelance
// (~20 richieste più recenti, server-rendered). Struttura verificata
// il 04/07/2026: item = .lavoro-section > .floatwidth100, titolo/link
// in h4 a, testo in .pre-text p, budget e data relativa ("20 ore fa")
// nelle coppie .listing-col. Il contatto è sempre dietro account.
// ============================================================

const LIST_URL = "https://www.addlance.com/lavoro-freelance";

interface AddlanceItem {
  title: string;
  url: string;
  body: string;
  budget: string;
  dateText: string;
}

/** "30 minuti fa" / "20 ore fa" / "3 giorni fa" / "un'ora fa" → ISO.
 *  Testo non riconosciuto → "" (lo scoring lo tratterà come non fresco).
 *  Le forme singolari ("un giorno", "un'ora", "una settimana") valgono 1:
 *  sono proprio le richieste più fresche, non devono perdere il bonus. */
export function parseRelativeDate(text: string, now = new Date()): string {
  const m = text
    .toLowerCase()
    .match(/(\d+|un'?|una)\s*(minut|or[ae]|giorn|settiman|mes)/);
  if (!m) return "";
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const unitMs: Record<string, number> = {
    minut: 60_000,
    or: 3_600_000,
    giorn: 86_400_000,
    settiman: 7 * 86_400_000,
    mes: 30 * 86_400_000,
  };
  const key = Object.keys(unitMs).find((k) => m[2].startsWith(k));
  if (!key) return "";
  return new Date(now.getTime() - n * unitMs[key]).toISOString();
}

export async function scrapeAddlance(page: Page): Promise<RawIntentRequest[]> {
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector(".lavoro-section .floatwidth100", {
    timeout: 20_000,
  });

  const items = await page.evaluate((): AddlanceItem[] => {
    const rows = Array.from(
      document.querySelectorAll(".lavoro-section .floatwidth100"),
    );
    return rows.map((row) => {
      const link = row.querySelector<HTMLAnchorElement>("h4 a");
      const body =
        row.querySelector(".pre-text p")?.textContent?.trim() ?? "";
      // Coppie .listing-col: heading (BUDGET(€) / DATA) + valore.
      const cols = Array.from(row.querySelectorAll(".listing-col"));
      let budget = "";
      let dateText = "";
      for (const col of cols) {
        const heading =
          col.querySelector(".heading")?.textContent?.trim().toLowerCase() ??
          "";
        const value =
          col.querySelector("p:not(.heading)")?.textContent?.trim() ?? "";
        if (heading.includes("budget")) budget = value;
        if (heading.includes("data")) dateText = value;
      }
      return {
        title: link?.textContent?.trim() ?? "",
        url: link?.href ?? "",
        body,
        budget,
        dateText,
      };
    });
  });

  // Righe trovate ma nessuna estraibile = DOM interno cambiato: errore
  // esplicito, non uno "0 richieste" silenzioso indistinguibile da un
  // giorno tranquillo (lo scout lo tratta come scraper rotto).
  const usable = items.filter(
    (it) => it.title && it.url.startsWith("http"),
  );
  if (items.length > 0 && usable.length === 0) {
    throw new Error(
      `addlance: ${items.length} righe trovate ma 0 estraibili — selettori interni cambiati?`,
    );
  }

  return usable.map((it) => ({
      platform: "addlance" as const,
      title: it.title,
      body: it.body,
      // La lista non espone la categoria: la deduce il filtro keyword.
      category: "",
      // Zona non strutturata: spesso è nel testo ("ristorante a Milano").
      zone: "",
      budget: /da definire/i.test(it.budget) ? "" : it.budget,
      published_at: parseRelativeDate(it.dateText),
      source_url: it.url,
      contact: "", // sempre dietro login su AddLance
    }));
}
