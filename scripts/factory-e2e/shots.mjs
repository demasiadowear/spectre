// ============================================================
// QA visuale e tecnico sulle demo generate.
//
// Screenshot VERI con Chromium contro un server Next VERO che rende la
// route /preview/[slug] vera. Non è un mock: è la pagina che vedrebbe
// il titolare.
//
// Raccoglie anche i dati del QA tecnico che si possono misurare solo a
// pagina viva: stato HTTP, errori di console, richieste fallite, meta
// robots, overflow orizzontale, contrasto della CTA, sezioni vuote.
//
// Uso: node scripts/factory-e2e/shots.mjs <base-url>
// ============================================================

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });

const BASE = (process.argv[2] ?? "http://127.0.0.1:4311").replace(/\/+$/, "");
const demos = JSON.parse(readFileSync(join(OUT, "demos.json"), "utf8"));

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

function executablePath() {
  const explicit = process.env.FACTORY_CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit) return explicit;
  return "/opt/pw-browsers/chromium";
}

async function main() {
  const browser = await chromium.launch({
    executablePath: executablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const findings = [];

  for (const demo of demos) {
    const url = `${BASE}/preview/${demo.slug}`;
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.name === "mobile" ? 2 : 1,
        locale: "it-IT",
      });
      const page = await context.newPage();

      const consoleErrors = [];
      const failedRequests = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
      });
      page.on("requestfailed", (r) => {
        failedRequests.push(`${r.url().slice(0, 160)} — ${r.failure()?.errorText ?? "?"}`);
      });

      const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      const status = res?.status() ?? 0;

      // --- Misure che hanno senso solo a pagina viva ---
      const audit = await page.evaluate(() => {
        const doc = document;
        const bodyW = doc.documentElement.scrollWidth;
        const viewW = doc.documentElement.clientWidth;

        // Elementi che sbordano oltre il viewport: è la causa numero uno
        // dello scroll orizzontale su telefono.
        const overflowing = [];
        doc.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > viewW + 1 || r.left < -1)) {
            overflowing.push(
              `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""} (${Math.round(r.left)}→${Math.round(r.right)})`,
            );
          }
        });

        // Sezioni senza contenuto visibile: un titolo e il vuoto sotto.
        const emptySections = [];
        doc.querySelectorAll("section").forEach((s) => {
          const text = (s.textContent ?? "").replace(/\s+/g, " ").trim();
          const h = s.querySelector("h2");
          const headingLen = (h?.textContent ?? "").trim().length;
          if (text.length <= headingLen + 2) emptySections.push((h?.textContent ?? "?").trim());
        });

        // Testo troncato: scrollWidth maggiore della larghezza resa.
        const clipped = [];
        doc.querySelectorAll("h1, h2, h3, p, li, a, span").forEach((el) => {
          if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
            clipped.push(`${el.tagName.toLowerCase()}: ${(el.textContent ?? "").slice(0, 50)}`);
          }
        });

        const parseColor = (c) => {
          const m = c.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const [r, g, b] = m[1].split(",").map((x) => parseFloat(x));
          return [r, g, b];
        };
        const lum = ([r, g, b]) => {
          const f = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const contrast = (a, b) => {
          const la = lum(a);
          const lb = lum(b);
          return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
        };

        // Contrasto del corpo e della CTA principale.
        const bodyStyle = getComputedStyle(doc.body);
        const bodyFg = parseColor(bodyStyle.color);
        const bodyBg = parseColor(bodyStyle.backgroundColor);
        const bodyContrast = bodyFg && bodyBg ? contrast(bodyFg, bodyBg) : null;

        const ctaEl = doc.querySelector("header a[href]");
        let ctaContrast = null;
        let ctaBox = null;
        if (ctaEl) {
          const cs = getComputedStyle(ctaEl);
          const fg = parseColor(cs.color);
          const bg = parseColor(cs.backgroundColor);
          ctaContrast = fg && bg ? contrast(fg, bg) : null;
          const r = ctaEl.getBoundingClientRect();
          ctaBox = { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
        }

        const imgs = Array.from(doc.querySelectorAll("img")).map((i) => ({
          src: i.currentSrc || i.src,
          natural: `${i.naturalWidth}x${i.naturalHeight}`,
          rendered: `${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}`,
          broken: i.complete && i.naturalWidth === 0,
        }));

        const robots = doc.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
        const links = Array.from(doc.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? "");

        return {
          title: doc.title,
          robots,
          horizontalOverflow: bodyW > viewW + 1,
          scrollWidth: bodyW,
          clientWidth: viewW,
          overflowing: overflowing.slice(0, 10),
          emptySections,
          clipped: clipped.slice(0, 10),
          bodyContrast: bodyContrast ? Number(bodyContrast.toFixed(2)) : null,
          ctaContrast: ctaContrast ? Number(ctaContrast.toFixed(2)) : null,
          ctaBox,
          images: imgs,
          links,
          headings: Array.from(doc.querySelectorAll("h1, h2")).map(
            (h) => `${h.tagName}: ${(h.textContent ?? "").trim().slice(0, 60)}`,
          ),
          textLength: (doc.body.textContent ?? "").replace(/\s+/g, " ").trim().length,
        };
      });

      const file = join(SHOTS, `${demo.id}-${vp.name}.png`);
      await page.screenshot({ path: file, fullPage: true });

      // Ritagli mirati sulle zone che si guardano davvero.
      const crops = {};
      for (const [label, selector] of [
        ["hero", "header"],
        ["servizi", "section:has(ul.grid)"],
        ["footer", "footer"],
      ]) {
        try {
          const el = await page.$(selector);
          if (el) {
            const p = join(SHOTS, `${demo.id}-${vp.name}-${label}.png`);
            await el.screenshot({ path: p });
            crops[label] = p;
          }
        } catch {
          /* selettore non applicabile a questa demo */
        }
      }

      findings.push({
        id: demo.id,
        viewport: vp.name,
        url,
        status,
        consoleErrors,
        failedRequests,
        screenshot: file,
        crops,
        ...audit,
      });

      await context.close();
    }
  }

  await browser.close();
  writeFileSync(join(OUT, "visual-qa.json"), JSON.stringify(findings, null, 2));

  // --- Riepilogo leggibile ---
  console.log("\n=== QA VISUALE E TECNICO ===");
  const problems = [];
  for (const f of findings) {
    console.log(`\n${f.id} · ${f.viewport} (${f.clientWidth}px)`);
    console.log(`  HTTP ${f.status} · titolo "${f.title}"`);
    console.log(`  robots: ${f.robots || "(assente)"}`);
    console.log(`  testo reso: ${f.textLength} caratteri · sezioni: ${f.headings.length}`);
    console.log(`  contrasto corpo: ${f.bodyContrast ?? "?"} · CTA: ${f.ctaContrast ?? "?"}`);
    if (f.ctaBox) console.log(`  CTA: ${f.ctaBox.w}x${f.ctaBox.h}px a ${f.ctaBox.top}px dall'alto`);
    console.log(`  immagini: ${f.images.length} (${f.images.filter((i) => i.broken).length} rotte)`);

    const add = (msg) => {
      problems.push(`${f.id}/${f.viewport}: ${msg}`);
      console.log(`  PROBLEMA ${msg}`);
    };
    if (f.status !== 200) add(`HTTP ${f.status}`);
    if (!/noindex/i.test(f.robots)) add("manca noindex");
    if (f.horizontalOverflow) add(`scroll orizzontale (${f.scrollWidth} > ${f.clientWidth})`);
    if (f.overflowing.length) add(`elementi fuori viewport: ${f.overflowing.join(", ")}`);
    if (f.emptySections.length) add(`sezioni vuote: ${f.emptySections.join(", ")}`);
    if (f.clipped.length) add(`testo troncato: ${f.clipped.join(" | ")}`);
    if (f.consoleErrors.length) add(`errori console: ${f.consoleErrors.join(" | ")}`);
    if (f.failedRequests.length) add(`richieste fallite: ${f.failedRequests.join(" | ")}`);
    if (f.images.some((i) => i.broken)) add("immagini non caricate");
    if (f.bodyContrast !== null && f.bodyContrast < 4.5) add(`contrasto corpo ${f.bodyContrast} < 4.5`);
    if (f.ctaContrast !== null && f.ctaContrast < 4.5) add(`contrasto CTA ${f.ctaContrast} < 4.5`);
    if (f.ctaBox && f.ctaBox.h < 44 && f.viewport === "mobile") {
      add(`CTA alta ${f.ctaBox.h}px, sotto i 44px del tocco`);
    }
    const unsafe = f.links.filter((h) => /^(javascript|data|vbscript):/i.test(h));
    if (unsafe.length) add(`link non sicuri: ${unsafe.join(", ")}`);
  }

  console.log(`\n${problems.length} problemi rilevati`);
  writeFileSync(join(OUT, "visual-problems.json"), JSON.stringify(problems, null, 2));
  if (problems.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error("SHOTS FALLITO:", e);
  process.exitCode = 1;
});
