// La parallasse desktop dopo l'import dinamico: se ScrollTrigger non
// arriva, l'immagine resta ferma e non se ne accorge nessuno.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
const DIST = resolve(process.argv[2]);
const M={".html":"text/html;charset=utf-8",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp",".avif":"image/avif"};
const srv=createServer((q,r)=>{const p=decodeURIComponent((q.url??"/").split("?")[0]);let f=join(DIST,p==="/"?"/index.html":p);if(!existsSync(f)||statSync(f).isDirectory())f=join(DIST,"index.html");if(!existsSync(f)){r.writeHead(404);return r.end();}const b=readFileSync(f);r.writeHead(200,{"Content-Type":M[extname(f)]??"application/octet-stream","Content-Length":b.length});r.end(b);});
await new Promise(r=>srv.listen(4477,"127.0.0.1",r));
const br=await chromium.launch({executablePath:"/opt/pw-browsers/chromium",headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
for (const vp of [{n:"desktop",w:1440,h:900},{n:"mobile",w:390,h:844}]) {
  const pg=await br.newPage({viewport:{width:vp.w,height:vp.h},deviceScaleFactor:1});
  const chunk=[];
  pg.on("request",r=>{ if(/ScrollTrigger/.test(r.url())) chunk.push(r.url().split("/").pop()); });
  await pg.goto("http://127.0.0.1:4477/index.html",{waitUntil:"networkidle"});
  await pg.waitForTimeout(2500);
  const leggi=()=>pg.evaluate(()=>{const i=document.querySelector(".cucina-forno img");return i?getComputedStyle(i).transform:null;});
  await pg.evaluate(()=>{const f=document.querySelector(".cucina-forno");f&&f.scrollIntoView({block:"center",behavior:"instant"});});
  await pg.waitForTimeout(600); const a=await leggi();
  await pg.evaluate(()=>scrollBy(0,400)); await pg.waitForTimeout(800); const b=await leggi();
  console.log(`${vp.n.padEnd(8)} chunk ScrollTrigger: ${chunk.length?chunk.join(","):"non richiesto"}`);
  console.log(`         transform a  ${a}`);
  console.log(`         transform b  ${b}`);
  console.log(`         parallasse:  ${a!==b?"ATTIVA":"ferma"}`);
  await pg.close();
}
await br.close(); srv.close();
