// LCP misurato, non simulato: strozzatura di rete e di CPU vere via
// CDP, e l'ultimo candidato letto da PerformanceObserver. Serve a
// distinguere una causa da un'ipotesi.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DIST = resolve(process.argv[2] ?? "dist");
const SENZA_JS = process.env.SENZA_JS === "1";
const RIDOTTO = process.env.RIDOTTO === "1";
const M = { ".html":"text/html;charset=utf-8",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp",".avif":"image/avif" };
const srv = createServer((q,r)=>{const p=decodeURIComponent((q.url??"/").split("?")[0]);let f=join(DIST,p==="/"?"/index.html":p);if(!existsSync(f)||statSync(f).isDirectory())f=join(DIST,"index.html");if(!existsSync(f)){r.writeHead(404);return r.end();}const b=readFileSync(f);r.writeHead(200,{"Content-Type":M[extname(f)]??"application/octet-stream","Content-Length":b.length});r.end(b);});
await new Promise(r=>srv.listen(4466,"127.0.0.1",r));

const br = await chromium.launch({ executablePath:"/opt/pw-browsers/chromium", headless:true, args:["--no-sandbox","--disable-dev-shm-usage"] });
const ctx = await br.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, locale:"it-IT",
  reducedMotion: RIDOTTO ? "reduce" : "no-preference" });
const pg = await ctx.newPage();
if (SENZA_JS) await pg.route("**/assets/*.js", (r) => r.abort());

const cdp = await ctx.newCDPSession(pg);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline:false, latency:150, downloadThroughput: 1638400/8, uploadThroughput: 675000/8 });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

await pg.addInitScript(() => {
  window.__lcp = []; window.__fcp = null;
  new PerformanceObserver((l) => { for (const e of l.getEntries())
    window.__lcp.push({ t: e.startTime, tag: e.element?.tagName, cls: e.element?.className, size: e.size });
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries())
    if (e.name === "first-contentful-paint") window.__fcp = e.startTime;
  }).observe({ type: "paint", buffered: true });
});

await pg.goto("http://127.0.0.1:4466/index.html", { waitUntil: "load", timeout: 60000 });
await pg.waitForTimeout(5000);
const r = await pg.evaluate(() => ({ lcp: window.__lcp, fcp: window.__fcp }));
const ultimo = r.lcp[r.lcp.length - 1];
console.log(`\nmodalita: ${SENZA_JS ? "senza bundle" : RIDOTTO ? "movimento ridotto" : "normale"}`);
console.log(`  FCP  ${Math.round(r.fcp)} ms`);
console.log(`  LCP  ${ultimo ? Math.round(ultimo.t) : "—"} ms   (${ultimo ? ultimo.tag + "." + String(ultimo.cls).split(" ")[0] : ""})`);
console.log(`  candidati: ${r.lcp.map(c => `${Math.round(c.t)}ms ${c.tag}.${String(c.cls).split(" ")[0]}`).join("  |  ")}`);
await br.close(); srv.close();
