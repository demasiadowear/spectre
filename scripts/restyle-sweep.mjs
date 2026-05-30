// Restyle sweep: remap hardcoded dark surfaces/borders to semantic
// theme tokens across .tsx files. Literal replacements only.
// Run from project root: node scripts/restyle-sweep.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPLACEMENTS = [
  // surfaces (cards)
  ["bg-black/50", "bg-surface"],
  ["bg-black/40", "bg-surface"],
  ["bg-black/30", "bg-surface"],
  // heavy backdrops → warm scrim
  ["bg-black/90", "bg-scrim/80"],
  ["bg-black/70", "bg-scrim/60"],
  ["bg-black/60", "bg-scrim/50"],
  // subtle fills
  ["bg-white/10", "bg-surface2"],
  ["bg-white/5", "bg-surface2"],
  ["bg-white/[0.03]", "bg-surface2"],
  ["bg-white/[0.04]", "bg-surface2"],
  // neutral borders
  ["border-white/10", "border-border"],
  ["border-white/15", "border-border"],
  ["border-white/20", "border-border"],
  ["border-spectre-cyan/15", "border-border"],
  ["border-spectre-cyan/20", "border-border"],
  ["border-spectre-cyan/25", "border-border"],
  // text on coloured fills
  ["text-black", "text-onaccent"],
  ["text-white", "text-text"],
];

const roots = ["components", "app"];
let files = 0;
let total = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) processFile(p);
  }
}

function processFile(path) {
  let src = readFileSync(path, "utf8");
  let count = 0;
  for (const [from, to] of REPLACEMENTS) {
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

for (const r of roots) walk(r);
console.log(`\nFile modificati: ${files} · sostituzioni totali: ${total}`);
