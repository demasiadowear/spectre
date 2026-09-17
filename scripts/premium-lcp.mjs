// ============================================================
// Il LCP smontato nelle sue quattro fasi.
//
// Uno score non dice dove si perde il tempo. Lighthouse lo sa e lo
// scrive in `largest-contentful-paint-element`: TTFB, ritardo prima che
// la richiesta parta, durata dello scaricamento, ritardo fra il byte
// arrivato e il pixel dipinto. Finche non si sa quale delle quattro
// pesa, ogni intervento e un tentativo.
//
// Si stampa anche la catena critica e il verdetto degli audit che
// riguardano l'elemento LCP, perche e li che di solito c'e scritto il
// motivo.
//
// Uso: node scripts/premium-lcp.mjs <dist> [modo] [porta]
// ============================================================
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const esegui = promisify(execFile);
const DIST = resolve(process.argv[2] ?? "dist");
const MODO = process.argv[3] ?? "mobile";
const PORTA = Number(process.argv[4] ?? 4397);

const M = {
  ".html": "text/html;charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".avif": "image/avif", ".jpg": "image/jpeg",
};
const srv = createServer((q, r) => {
  const p = decodeURIComponent((q.url ?? "/").split("?")[0]);
  let f = join(DIST, p === "/" ? "/index.html" : p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
  const b = readFileSync(f);
  r.writeHead(200, { "Content-Type": M[extname(f)] ?? "application/octet-stream", "Content-Length": b.length });
  r.end(b);
});
await new Promise((r) => srv.listen(PORTA, "127.0.0.1", r));

const out = join(tmpdir(), `lh-lcp-${MODO}.json`);
const args = ["--yes", "lighthouse@13.4.1", `http://127.0.0.1:${PORTA}/index.html`, "--quiet",
  `--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage${process.env.RIDOTTO === "1" ? " --force-prefers-reduced-motion" : ""}`,
  "--output=json", `--output-path=${out}`, "--only-categories=performance"];
if (MODO === "desktop") args.push("--preset=desktop");
await esegui("npx", args, { env: { ...process.env, CHROME_PATH: "/opt/pw-browsers/chromium" }, maxBuffer: 1 << 26 });
srv.close();

const r = JSON.parse(readFileSync(out, "utf8"));
const a = r.audits;
const ms = (n) => `${Math.round(n)} ms`;

console.log(`\n=== LCP ${MODO} ===`);
console.log(`LCP        ${a["largest-contentful-paint"].displayValue}`);
console.log(`FCP        ${a["first-contentful-paint"].displayValue}`);
console.log(`TTFB       ${a["server-response-time"]?.displayValue ?? "—"}`);
console.log(`velocita   ${r.configSettings.throttling.throughputKbps} Kbps, RTT ${r.configSettings.throttling.rttMs} ms, CPU x${r.configSettings.throttling.cpuSlowdownMultiplier}`);

const el = a["largest-contentful-paint-element"];
const elemento = el?.details?.items?.find((i) => i.type === "list" || i.node || i.items);
const nodo = el?.details?.items?.[0]?.items?.[0]?.node ?? el?.details?.items?.[0]?.node;
if (nodo) console.log(`\nelemento   ${nodo.selector ?? nodo.snippet ?? "?"}`);
if (nodo?.snippet) console.log(`           ${nodo.snippet.slice(0, 160)}`);

// Le quattro fasi stanno nella seconda tabella dell'audit.
const fasi = el?.details?.items?.find((i) => i.headings?.some?.((h) => /phase/i.test(h.key ?? "")))
  ?? el?.details?.items?.[1];
if (fasi?.items) {
  console.log("\nfase                          durata      quota");
  const tot = fasi.items.reduce((s, i) => s + (i.timing ?? 0), 0);
  for (const i of fasi.items) {
    const q = tot ? `${Math.round((i.timing / tot) * 100)}%` : "";
    console.log(`  ${String(i.phase ?? i.label).padEnd(26)} ${ms(i.timing).padStart(8)}   ${q.padStart(5)}`);
  }
  console.log(`  ${"TOTALE".padEnd(26)} ${ms(tot).padStart(8)}`);
} else {
  console.log("\n(nessuna tabella di fasi nell'audit)");
}

// Gli audit che parlano proprio dell'elemento LCP.
console.log("\nAudit collegati:");
for (const k of ["prioritize-lcp-image", "lcp-lazy-loaded", "uses-responsive-images",
  "modern-image-formats", "efficient-animated-content", "render-blocking-resources",
  "unused-css-rules", "font-display", "uses-text-compression", "total-byte-weight",
  "network-server-latency", "redirects", "critical-request-chains"]) {
  const x = a[k];
  if (!x || x.score === null) continue;
  const segno = x.score >= 0.9 ? "ok" : "  ->";
  console.log(`  ${segno} ${k.padEnd(28)} ${x.displayValue ?? (x.score === 1 ? "" : `score ${x.score}`)}`);
}

// La catena critica: chi deve finire prima che la LCP possa partire.
const cat = a["critical-request-chains"]?.details?.chains;
if (cat) {
  console.log("\nCatena critica:");
  const cammina = (n, liv) => {
    for (const k of Object.keys(n)) {
      const r = n[k].request;
      if (!r) continue;
      const url = String(r.url).replace(`http://127.0.0.1:${PORTA}`, "");
      console.log(`  ${"  ".repeat(liv)}${url.slice(0, 64).padEnd(66 - liv * 2)} ${ms((r.endTime - r.startTime) * 1000).padStart(8)}  ${Math.round((r.transferSize ?? 0) / 1024)} KB`);
      if (n[k].children) cammina(n[k].children, liv + 1);
    }
  };
  cammina(cat, 0);
}

// Le richieste nell'ordine in cui il browser le ha davvero fatte: il
// ritardo di partenza della LCP si legge qui e da nessun'altra parte.
const rete = a["network-requests"]?.details?.items ?? [];
if (rete.length) {
  console.log("\nRichieste (ordine reale):");
  console.log("  inizio    fine   durata  peso     risorsa");
  for (const i of rete.slice(0, 14)) {
    const url = String(i.url).replace(`http://127.0.0.1:${PORTA}`, "");
    console.log(`  ${ms(i.networkRequestTime).padStart(7)} ${ms(i.networkEndTime).padStart(7)} ${ms(i.networkEndTime - i.networkRequestTime).padStart(8)} ${String(Math.round((i.transferSize ?? 0) / 1024) + " KB").padStart(7)}  ${url.slice(0, 52)}`);
  }
}
