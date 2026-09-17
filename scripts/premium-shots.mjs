// ============================================================
// Screenshot e ispezione del sito premium.
//
// Serve `dist/` con un server statico locale (nessuna rete esterna:
// font e librerie sono bundlati) e cattura con il Chromium già presente
// nell'immagine. Raccoglie anche le misure che hanno senso solo a
// pagina viva: overflow, testo troncato, contrasto, errori console,
// peso trasferito, e FPS reali dell'animazione.
//
// Uso: node scripts/premium-shots.mjs <dir-dist> <out> <pagina...>
// ============================================================

import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DIST = resolve(process.argv[2] ?? "dist");
const OUT = resolve(process.argv[3] ?? "shots");
const PAGES = process.argv.slice(4).length ? process.argv.slice(4) : ["index.html"];
const PORT = 4330;
mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif",
  ".json": "application/json",
};

function serve() {
  const s = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = join(DIST, p === "/" ? "/index.html" : p);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end("404"); }
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Content-Length": body.length });
    res.end(body);
  });
  return new Promise((r) => s.listen(PORT, "127.0.0.1", () => r(s)));
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, dsf: 1 },
  { name: "mobile", width: 390, height: 844, dsf: 2 },
];

async function main() {
  const server = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.FACTORY_CHROME_PATH ?? "/opt/pw-browsers/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-gpu-rasterization"],
  });

  const report = [];
  for (const page of PAGES) {
    const slug = page.replace(/[\/.]/g, "_");
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.dsf,
        locale: "it-IT",
        reducedMotion: process.env.REDUCED === "1" ? "reduce" : "no-preference",
        // NOJS=1: lo stato a riposo della pagina. È quello che vede chi
        // ha JS lento, un blocco degli script, o un'anteprima di link.
        // Deve essere completo e leggibile, non "degradato".
        javaScriptEnabled: process.env.NOJS !== "1",
      });
      const pg = await ctx.newPage();

      const errors = [];
      const failed = [];
      let transferred = 0;
      pg.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 240)); });
      pg.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 240)}`));
      pg.on("requestfailed", (r) => failed.push(`${r.url().slice(0, 120)} ${r.failure()?.errorText ?? ""}`));
      pg.on("response", async (r) => {
        const len = Number(r.headers()["content-length"] ?? 0);
        if (Number.isFinite(len)) transferred += len;
      });

      const res = await pg.goto(`http://127.0.0.1:${PORT}/${page}`, { waitUntil: "networkidle", timeout: 30000 });
      // Le animazioni di ingresso devono aver finito prima dello scatto.
      await pg.waitForTimeout(2200);

      // FPS reali su ~1s di rendering. Senza JS non c'è niente da
      // misurare e `evaluate` non può nemmeno partire: si salta.
      const fps = process.env.NOJS === "1" ? null : await pg.evaluate(() => new Promise((done) => {
        let n = 0; const t0 = performance.now();
        const tick = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(tick) : done(Math.round(n * 1000 / (performance.now() - t0))); };
        requestAnimationFrame(tick);
      }));

      const audit = process.env.NOJS === "1" ? { title: "", overflow: false, scrollW: 0, viewW: vp.width, overflowing: [], clipped: [], emptySections: [], hiddenText: [], minContrast: null, worstContrast: null, sottoSoglia: [], cta: null, headings: [], fontsUsed: [] } : await pg.evaluate(() => {
        const d = document, de = d.documentElement;
        const viewW = de.clientWidth;
        const over = [];
        d.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > viewW + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed") {
            over.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] || "-"}`);
          }
        });
        // "Testo troncato" deve voler dire testo: un contenitore con un
        // elemento decorativo che deborda di proposito (una figura in
        // overflow:hidden) faceva scattare l'allarme con una stringa di
        // soli a-capo, e un allarme senza testo non si puo nemmeno
        // andare a cercare nello screenshot.
        const propria = (el) => [...el.childNodes]
          .filter((n) => n.nodeType === 3).map((n) => n.nodeValue ?? "").join("").trim();
        const clipped = [];
        d.querySelectorAll("h1,h2,h3,p,li,a,dd,dt,span,b").forEach((el) => {
          // Un elemento nascosto alla vista ma leggibile dai lettori di
          // schermo (lo skip link, l'intestazione di una tabella che su
          // telefono diventa elenco) e largo un pixel per costruzione: non
          // e testo troncato.
          if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 8 && propria(el)) {
            clipped.push(propria(el).slice(0, 40));
          }
        });
        const empty = [];
        d.querySelectorAll("section").forEach((s) => {
          const t = (s.textContent ?? "").replace(/\s+/g, " ").trim();
          const h = s.querySelector("h2,h3");
          if (t.length <= ((h?.textContent ?? "").trim().length + 2)) empty.push((h?.textContent ?? "?").trim());
        });
        const hidden = [];
        d.querySelectorAll("h1,h2,h3,p,li,a").forEach((el) => {
          const cs = getComputedStyle(el);
          // La chrome fissa che compare scorrendo (una barra di chiamata,
          // un torna-su) è legittimamente invisibile a riposo: la regola
          // riguarda il CONTENUTO parcheggiato, non i comandi flottanti.
          if (cs.position === "fixed") return;
          if (parseFloat(cs.opacity) < 0.05 && el.getBoundingClientRect().height > 0) {
            hidden.push((el.textContent ?? "").slice(0, 40));
          }
        });
        const par = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b] = m[1].split(",").map(parseFloat); return [r, g, b]; };
        const lum = ([r, g, b]) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
        const bg = par(getComputedStyle(d.body).backgroundColor) ?? [0, 0, 0];
        // Il contrasto si misura solo dove il testo sta DAVVERO sul fondo
        // della pagina: un elemento con sfondo proprio (la CTA, lo skip
        // link) va confrontato col suo, non con quello del body, e uno
        // fuori schermo o senza testo non va misurato affatto. Senza
        // questi tre filtri l'auditor segnalava "contrasto 1" su cose
        // perfettamente leggibili, e il rumore nasconde i difetti veri.
        // Lo sfondo vero di un elemento è quello del primo antenato
        // opaco, non quello del body: su una pagina fatta di pannelli
        // chiari appoggiati su un campo colorato, confrontare col body
        // dava "contrasto 2,65" su un testo scuro perfettamente
        // leggibile, e un auditor rumoroso nasconde i difetti veri.
        const opacoDi = (cs) => {
          const c = par(cs.backgroundColor);
          if (!c) return null;
          const m = cs.backgroundColor.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/);
          return m && parseFloat(m[1]) < 0.85 ? null : c;
        };
        const fondoDi = (el) => {
          for (let n = el; n && n !== d.documentElement; n = n.parentElement) {
            const c = opacoDi(getComputedStyle(n));
            if (c) return c;
          }
          return bg;
        };
        const contrasts = [];
        d.querySelectorAll("h1,h2,h3,p,a,dd,li,th,td,address,button,summary,label,caption").forEach((el) => {
          const cs = getComputedStyle(el);
          const testo = (el.textContent ?? "").trim();
          if (!testo) return;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right < 0 || r.left > de.clientWidth) return;
          const fg = par(cs.color);
          if (!fg) return;
          // WCAG: il testo grande (>= 24px, o >= 18.7px in grassetto) ha
          // soglia 3, non 4,5. Senza questa distinzione un titolo da
          // 7rem risultava insufficiente pur essendo a norma, e la
          // correzione sarebbe stata peggiorare il titolo.
          const px = parseFloat(cs.fontSize);
          const peso = parseInt(cs.fontWeight, 10) || 400;
          const grande = px >= 24 || (px >= 18.66 && peso >= 700);
          contrasts.push({
            t: testo.slice(0, 28),
            r: +ratio(fg, fondoDi(el)).toFixed(2),
            soglia: grande ? 3 : 4.5,
          });
        });
        // La CTA principale si dichiara con data-cta: ogni sito ha la
        // sua (telefono, prenotazione, modulo) e cercare `tel:` valeva
        // solo per la barberia.
        const cta = d.querySelector("[data-cta]") ?? d.querySelector("a[href^='tel:']");
        const cr = cta?.getBoundingClientRect();
        const ctaCs = cta ? getComputedStyle(cta) : null;
        const ctaFg = ctaCs ? par(ctaCs.color) : null;
        const ctaBg = ctaCs ? par(ctaCs.backgroundColor) : null;
        return {
          title: d.title,
          overflow: de.scrollWidth > viewW + 1,
          scrollW: de.scrollWidth, viewW,
          overflowing: [...new Set(over)].slice(0, 8),
          clipped: clipped.slice(0, 6),
          emptySections: empty,
          hiddenText: hidden.slice(0, 6),
          minContrast: contrasts.length ? Math.min(...contrasts.map((c) => c.r)) : null,
          sottoSoglia: contrasts.filter((c) => c.r < c.soglia)
            .sort((a, b) => a.r - b.r).slice(0, 4),
          worstContrast: contrasts.sort((a, b) => a.r - b.r)[0] ?? null,
          cta: cr ? { w: Math.round(cr.width), h: Math.round(cr.height), contrast: ctaFg && ctaBg ? +ratio(ctaFg, ctaBg).toFixed(2) : null } : null,
          headings: [...d.querySelectorAll("h1,h2")].map((h) => `${h.tagName}:${(h.textContent ?? "").trim().slice(0, 46)}`),
          fontsUsed: [...new Set([...d.querySelectorAll("h1,h2,p,a")].map((e) => getComputedStyle(e).fontFamily.split(",")[0].replace(/"/g, "")))],
        };
      });

      // Il peso che conta e quello di chi apre e basta: si fotografa
      // qui, prima di scorrere, perche lo scorrimento tira giu tutto il
      // lazy-load e falserebbe il numero.
      const pesoIniziale = transferred;

      // Uno scatto a pagina intera cattura anche cio che non e mai
      // stato in vista, e `loading="lazy"` non ha nessun motivo di aver
      // caricato quelle immagini: verrebbero fuori bande vuote che nel
      // sito non esistono. Si scorre tutta la pagina, si aspetta che
      // ogni <img> sia decodificata, e solo allora si scatta.
      if (process.env.NOJS === "1") {
        // Senza JavaScript `evaluate` non esiste: si scorre con la
        // rotella, che e poi quello che farebbe una persona.
        for (let i = 0; i < 40; i++) { await pg.mouse.wheel(0, 800); await pg.waitForTimeout(90); }
        await pg.keyboard.press("Home");
      } else {
        await pg.evaluate(async () => {
          const passo = Math.round(innerHeight * 0.8);
          for (let y = 0; y < document.body.scrollHeight; y += passo) {
            scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 110));
          }
          // Si aspetta stando in fondo: tornare in cima prima dell'attesa
          // rimetterebbe fuori vista le immagini rinviate, che a quel
          // punto non partirebbero mai e l'attesa non finirebbe.
          await Promise.race([
            Promise.all([...document.querySelectorAll("img")]
              .filter((i) => !i.complete)
              .map((i) => new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }))),
            new Promise((r) => setTimeout(r, 8000)),
          ]);
          scrollTo(0, 0);
        });
      }
      await pg.waitForTimeout(900);
      const nonDipinte = process.env.NOJS === "1" ? null : await pg.evaluate(() =>
        [...document.querySelectorAll("img")].filter((i) => !(i.complete && i.naturalWidth > 0)).length);

      const file = join(OUT, `${slug}-${vp.name}.png`);
      await pg.screenshot({ path: file, fullPage: true });
      report.push({ page, viewport: vp.name, status: res?.status() ?? 0, fps, transferredKB: Math.round(pesoIniziale / 1024), transferredTotaleKB: Math.round(transferred / 1024), immaginiNonDipinte: nonDipinte, errors, failed, screenshot: file, ...audit });
      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  writeFileSync(join(OUT, "audit.json"), JSON.stringify(report, null, 2));

  const problemi = [];
  for (const r of report) {
    console.log(`\n${r.page} · ${r.viewport} (${r.viewW}px) — HTTP ${r.status} · ${r.fps} fps · ~${r.transferredKB} KB`);
    console.log(`  font: ${r.fontsUsed.join(", ")}`);
    console.log(`  contrasto minimo: ${r.minContrast}${r.worstContrast ? ` ("${r.worstContrast.t}")` : ""}`);
    if (r.cta) console.log(`  CTA: ${r.cta.w}x${r.cta.h}px, contrasto ${r.cta.contrast}`);
    const add = (m) => { problemi.push(`${r.page}/${r.viewport}: ${m}`); console.log(`  PROBLEMA ${m}`); };
    if (r.status !== 200) add(`HTTP ${r.status}`);
    if (r.overflow) add(`scroll orizzontale (${r.scrollW}>${r.viewW}) — ${r.overflowing.join(", ")}`);
    if (r.clipped.length) add(`testo troncato: ${r.clipped.join(" | ")}`);
    if (r.emptySections.length) add(`sezioni vuote: ${r.emptySections.join(", ")}`);
    if (r.hiddenText.length) add(`testo invisibile a riposo: ${r.hiddenText.join(" | ")}`);
    if (r.errors.length) add(`console: ${r.errors.join(" | ")}`);
    if (r.failed.length) add(`richieste fallite: ${r.failed.join(" | ")}`);
    for (const c of r.sottoSoglia ?? []) add(`contrasto ${c.r} < ${c.soglia} ("${c.t}")`);
    if (r.cta && r.cta.h < 44 && r.viewport === "mobile") add(`CTA alta ${r.cta.h}px < 44`);
    if (r.cta && r.cta.contrast !== null && r.cta.contrast < 4.5) add(`contrasto CTA ${r.cta.contrast} < 4.5`);
    if (r.fps !== null && r.fps < 50 && r.viewport === "desktop") add(`${r.fps} fps`);
  }
  console.log(`\n${problemi.length} problemi`);
  writeFileSync(join(OUT, "problemi.json"), JSON.stringify(problemi, null, 2));
}

main().catch((e) => { console.error("FALLITO:", e); process.exitCode = 1; });
