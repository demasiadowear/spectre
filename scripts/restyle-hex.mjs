// Second sweep: convert leftover inline cyberpunk hex colours to the
// earth palette. WhatsApp brand green (#25D366 / #1ea952) is preserved.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MAP = [
  ["#00f0ff", "#C2410C"],
  ["#0091a8", "#9A3412"],
  ["#ff006e", "#B0492B"],
  ["#ffbe0b", "#B07D2B"],
  ["#38b000", "#5C7A5C"],
  ["#ff6a00", "#C2410C"],
  ["#ff8c42", "#E2632B"],
  ["#5b6470", "#8C7B63"],
  ["#6b7280", "#8C7B63"],
  ["#52525b", "#8A8170"],
  ["#050505", "#3A3327"],
];

let files = 0;
let total = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) proc(p);
  }
}
function proc(path) {
  let src = readFileSync(path, "utf8");
  let count = 0;
  for (const [from, to] of MAP) {
    const parts = src.split(from);
    if (parts.length > 1) {
      count += parts.length - 1;
      src = parts.join(to);
    }
  }
  if (count > 0) {
    writeFileSync(path, src, "utf8");
    files++;
    total += count;
    console.log(`  ${path}: ${count}`);
  }
}
walk("components");
console.log(`\nFile: ${files} · sostituzioni: ${total}`);
