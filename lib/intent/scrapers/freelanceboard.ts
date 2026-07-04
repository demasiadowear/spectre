import type { Page } from "playwright-core";
import type { RawIntentRequest } from "@/types/intent";

// ============================================================
// Scraper Freelanceboard — liste pubbliche per categoria
// https://www.freelanceboard.it/progetti.php?category=…
// Struttura verificata il 04/07/2026: card .job-listing con
// h3.job-listing-title (+ link project_detail.php/<slug>),
// p.job-listing-text, footer <li> con tooltip Categoria /
// Posizione / Data e ora di creazione (DD-MM-YYYY).
// Ragione sociale dietro login; il resto è pubblico.
// ============================================================

// Il parametro ?category= è ignorato dal caricamento AJAX (verificato
// 04/07/2026: stessa lista per ogni categoria) — si scrapa una volta
// sola la lista globale dei più recenti; la categoria la fa il filtro
// keyword a valle.
const LIST_URL = "https://www.freelanceboard.it/progetti.php";

interface FbItem {
  title: string;
  url: string;
  body: string;
  category: string;
  zone: string;
  dateText: string;
}

/** "24-06-2026" (DD-MM-YYYY) → ISO a mezzanotte. Non parsabile → "". */
export function parseFbDate(text: string): string {
  const m = text.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return "";
  const iso = `${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? "" : iso;
}

async function scrapeList(page: Page): Promise<FbItem[]> {
  await page.goto(LIST_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  // Le card arrivano via AJAX dentro .listings-container.
  await page.waitForSelector(".listings-container .job-listing", {
    timeout: 25_000,
  });

  return page.evaluate((): FbItem[] => {
    const cards = Array.from(
      document.querySelectorAll(".listings-container .job-listing"),
    );
    return cards.map((card) => {
      const titleEl = card.querySelector("h3.job-listing-title");
      const link = titleEl?.closest("a") ?? card.querySelector("a[href*='project_detail']");
      const body =
        card.querySelector("p.job-listing-text")?.textContent?.trim() ?? "";
      let category = "";
      let zone = "";
      let dateText = "";
      for (const li of Array.from(
        card.querySelectorAll(".job-listing-footer li"),
      )) {
        const tip = li.getAttribute("data-original-title") ?? "";
        const value = li.textContent?.trim() ?? "";
        if (tip === "Categoria") category = value;
        else if (tip === "Posizione") zone = value;
        else if (tip.startsWith("Data")) dateText = value;
      }
      return {
        title: titleEl?.textContent?.trim() ?? "",
        url: (link as HTMLAnchorElement | null)?.href ?? "",
        body,
        category,
        zone,
        dateText,
      };
    });
  });
}

export async function scrapeFreelanceboard(
  page: Page,
): Promise<RawIntentRequest[]> {
  const all = await scrapeList(page);
  // V. commento gemello in addlance.ts: card presenti ma inutilizzabili
  // = DOM interno cambiato → errore esplicito, mai uno 0 silenzioso.
  const usable = all.filter((it) => it.title && it.url.startsWith("http"));
  if (all.length > 0 && usable.length === 0) {
    throw new Error(
      `freelanceboard: ${all.length} card trovate ma 0 estraibili — selettori interni cambiati?`,
    );
  }
  return usable.map((it) => ({
      platform: "freelanceboard" as const,
      title: it.title,
      body: it.body,
      category: it.category,
      zone: it.zone,
      budget: "", // la lista non espone budget
      published_at: parseFbDate(it.dateText),
      source_url: it.url,
      contact: "", // ragione sociale dietro login
    }));
}
