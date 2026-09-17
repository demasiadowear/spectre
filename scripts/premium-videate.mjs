// ============================================================
// Videate a dimensione reale.
//
// Lo screenshot a pagina intera rimpicciolito nasconde proprio quello
// che conta: il corpo del testo, il contrasto, il peso dei bordi. Qui
// si fotografa il VIEWPORT, 390x844 e 1440x900, portato su ogni punto
// che si vuole giudicare.
//
// Uso: node scripts/premium-videate.mjs <dist> <out> nome:selettore ...
//   nome:selettore          viewport mobile fermo su quel punto
//   nome:selettore@desktop  lo stesso a 1440x900
//   nome:selettore!click    tocca il selettore e fotografa dopo
// ============================================================
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DIST = resolve(process.argv[2] ?? "dist");
const OUT = resolve(process.argv[3] ?? "videate");
const PUNTI = process.argv.slice(4);
mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html;charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".avif": "image/avif", ".jpg": "image/jpeg" };
const srv = createServer((q, r) => {
  const p = decodeURIComponent((q.url ?? "/").split("?")[0]);
  let f = join(DIST, p === "/" ? "/index.html" : p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
  const b = readFileSync(f);
  r.writeHead(200, { "Content-Type": MIME[extname(f)] ?? "application/octet-stream" });
  r.end(b);
});
await new Promise((r) => srv.listen(4368, "127.0.0.1", r));

const br = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const voce of PUNTI) {
  const desktop = voce.endsWith("@desktop");
  const grezzo = desktop ? voce.slice(0, -8) : voce;
  const [spec, daToccare] = grezzo.split("!click");
  const i = spec.indexOf(":");
  const nome = spec.slice(0, i);
  const sel = spec.slice(i + 1);
  const vp = desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 };

  const pg = await br.newPage({ viewport: vp, deviceScaleFactor: 2, locale: "it-IT" });
  await pg.goto("http://127.0.0.1:4368/index.html", { waitUntil: "networkidle" });
  await pg.waitForTimeout(2500);

  if (daToccare !== undefined) {
    const t = pg.locator(sel).first();
    await t.scrollIntoViewIfNeeded();
    await pg.waitForTimeout(300);
    await t.click({ force: true });
    await pg.waitForTimeout(1200);
  } else if (sel !== "top") {
    // Si porta il punto in cima al viewport, con un po' d'aria sopra:
    // e come lo vede chi ci arriva scorrendo.
    await pg.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12, behavior: "instant" });
    }, sel);
    await pg.waitForTimeout(700);
  }
  await pg.screenshot({ path: join(OUT, `${nome}.png`) });
  await pg.close();
  console.log(`  ${nome} (${vp.width}x${vp.height})`);
}
await br.close();
srv.close();
