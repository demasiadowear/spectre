// Processo JustEat standard (ristoranti): Playwright headless, trova la
// pagina del ristorante, estrae i piatti (nome/descrizione/prezzo/immagine),
// scarica le immagini in public/images/menu/[slug]-NN.jpg e produce le
// voci per manifest.json.
//
// NOTA: i selettori del DOM JustEat cambiano nel tempo — sono raccolti
// in SELECTORS qui sotto, da aggiornare in un punto solo.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SELECTORS = {
  // Card piatto nella pagina menu del ristorante.
  item: '[data-qa="item-element"], [data-test-id="menu-item"]',
  name: '[data-qa="item-name"], [data-test-id="menu-item-name"], h3',
  description:
    '[data-qa="item-description"], [data-test-id="menu-item-description"], p',
  price: '[data-qa="item-price"], [data-test-id="menu-item-price"]',
  image: "img",
  cookieBanner: '#onetrust-accept-btn-handler, [data-qa="accept-cookies"]',
};

export function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Trova l'URL JustEat del ristorante via DuckDuckGo HTML (niente API key). */
async function findRestaurantUrl(page, name, city) {
  const q = encodeURIComponent(`site:justeat.it ${name} ${city}`);
  await page.goto(`https://html.duckduckgo.com/html/?q=${q}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const href = await page
    .locator('a.result__a[href*="justeat.it"]')
    .first()
    .getAttribute("href", { timeout: 10_000 })
    .catch(() => null);
  return href;
}

/**
 * Scrape del menu. Ritorna { url, dishes: [{name, description, price, image}] }
 * con `image` = path relativo dentro il sito demo. Lancia su fallimento:
 * il runner marca la build "failed" e Puccio interviene a mano.
 */
export async function scrapeJustEat(restaurantName, city, siteDir) {
  const slug = slugify(restaurantName);
  const imagesDir = join(siteDir, "public", "images", "menu");
  await mkdir(imagesDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });

    const url = await findRestaurantUrl(page, restaurantName, city);
    if (!url) {
      throw new Error(`pagina JustEat non trovata per "${restaurantName}" (${city})`);
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page
      .locator(SELECTORS.cookieBanner)
      .first()
      .click({ timeout: 5_000 })
      .catch(() => {});
    await page.waitForSelector(SELECTORS.item, { timeout: 20_000 });

    const rawDishes = await page.$$eval(
      SELECTORS.item,
      (cards, sel) =>
        cards.slice(0, 30).map((card) => ({
          name: card.querySelector(sel.name)?.textContent?.trim() ?? "",
          description:
            card.querySelector(sel.description)?.textContent?.trim() ?? "",
          price: card.querySelector(sel.price)?.textContent?.trim() ?? "",
          imageUrl: card.querySelector(sel.image)?.src ?? "",
        })),
      SELECTORS,
    );

    const dishes = [];
    let i = 0;
    for (const d of rawDishes.filter((d) => d.name)) {
      let image = "";
      if (d.imageUrl?.startsWith("http")) {
        try {
          const res = await page.request.get(d.imageUrl);
          if (res.ok()) {
            i++;
            const file = `${slug}-${String(i).padStart(2, "0")}.jpg`;
            await writeFile(join(imagesDir, file), await res.body());
            image = `/images/menu/${file}`;
          }
        } catch {
          /* immagine persa: piatto senza foto */
        }
      }
      dishes.push({
        name: d.name,
        description: d.description,
        price: d.price,
        image,
      });
    }

    if (dishes.length === 0) {
      throw new Error(`nessun piatto estratto da ${url} (selettori da aggiornare?)`);
    }
    return { url, dishes };
  } finally {
    await browser.close();
  }
}
