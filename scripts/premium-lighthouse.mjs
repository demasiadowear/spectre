// Lighthouse su una dist locale, desktop e telefono, senza dipendere da
// un server gia acceso: lo accende, misura, lo spegne.
//
// Uso: node scripts/premium-lighthouse.mjs <dist> <etichetta> [porta]
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// execFileSync bloccherebbe il ciclo di eventi, e il server http che
// abbiamo appena acceso vive in questo stesso processo: Lighthouse
// trovava la porta muta e si fermava su un interstitial.
const esegui = promisify(execFile);
import { tmpdir } from "node:os";

const DIST = resolve(process.argv[2] ?? "dist");
const NOME = process.argv[3] ?? "sito";
const PORTA = Number(process.argv[4] ?? 4391);
const M = { ".html": "text/html;charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

const srv = createServer((q, r) => {
  const p = decodeURIComponent((q.url ?? "/").split("?")[0]);
  let f = join(DIST, p === "/" ? "/index.html" : p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
  const b = readFileSync(f);
  r.writeHead(200, { "Content-Type": M[extname(f)] ?? "application/octet-stream", "Content-Length": b.length });
  r.end(b);
});
await new Promise((r) => srv.listen(PORTA, "127.0.0.1", r));

const righe = [];
for (const modo of ["desktop", "mobile"]) {
  const out = join(tmpdir(), `lh-${NOME}-${modo}.json`);
  const args = ["--yes", "lighthouse@13.4.1", `http://127.0.0.1:${PORTA}/index.html`, "--quiet",
    "--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage",
    "--output=json", `--output-path=${out}`,
    "--only-categories=performance,accessibility,best-practices"];
  if (modo === "desktop") args.push("--preset=desktop");
  await esegui("npx", args, { env: { ...process.env, CHROME_PATH: "/opt/pw-browsers/chromium" }, maxBuffer: 1 << 26 });
  const r = JSON.parse(readFileSync(out, "utf8"));
  const c = r.categories, a = r.audits;
  righe.push({
    modo,
    performance: Math.round(c.performance.score * 100),
    accessibilita: Math.round(c.accessibility.score * 100),
    bestPractices: Math.round(c["best-practices"].score * 100),
    cls: a["cumulative-layout-shift"].numericValue,
    lcp: a["largest-contentful-paint"].displayValue,
    tbt: a["total-blocking-time"].displayValue,
  });
}
srv.close();
for (const r of righe) {
  console.log(`${NOME} ${r.modo}: perf ${r.performance} · a11y ${r.accessibilita} · bp ${r.bestPractices} · CLS ${r.cls.toFixed(3)} · LCP ${r.lcp} · TBT ${r.tbt}`);
}
console.log(JSON.stringify(righe));
