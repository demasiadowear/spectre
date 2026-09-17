// ============================================================
// Il test che conta: i quattro siti della Factory appartengono allo
// stesso template system?
//
// Lighthouse a 100 non dice niente sull'originalita: un tema ridipinto
// quattro volte prende 100 quattro volte. Qui si misura la distanza fra
// i siti sulle dimensioni che un template non cambierebbe mai — le
// famiglie di caratteri, la palette, l'ordine delle sezioni, la
// geometria, l'oggetto che porta l'identita, il linguaggio del
// movimento, la CTA, la densita e il vocabolario delle classi.
//
// La barberia e in tabella come metro di paragone: e il benchmark
// approvato, e i tre nuovi devono essere lontani da lei quanto lo sono
// fra loro.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Sito {
  chiave: string;
  cartella: string;
  html: string;
  css: string;
  ts: string;
}

const RADICE = join(process.cwd(), "forge-projects");
const CARTELLE: Array<[string, string]> = [
  ["barberia", "gold-barberia-centrale"],
  ["ristorante", "showcase-ristorante-grecale"],
  ["dentista", "showcase-studio-dentistico"],
  ["beauty", "showcase-salone-camelia"],
];

const SITI: Sito[] = CARTELLE.map(([chiave, cartella]) => ({
  chiave,
  cartella,
  html: readFileSync(join(RADICE, cartella, "index.html"), "utf8"),
  css: readFileSync(join(RADICE, cartella, "src", "styles.css"), "utf8"),
  ts: readFileSync(join(RADICE, cartella, "src", "main.ts"), "utf8"),
}));

/** Ogni coppia non ordinata dei quattro siti. */
function coppie(): Array<[Sito, Sito]> {
  const out: Array<[Sito, Sito]> = [];
  for (let i = 0; i < SITI.length; i++) {
    for (let j = i + 1; j < SITI.length; j++) out.push([SITI[i], SITI[j]]);
  }
  return out;
}

const insieme = <T>(v: T[]): Set<T> => new Set(v);
const intersezione = <T>(a: Set<T>, b: Set<T>): T[] =>
  Array.from(a).filter((x) => b.has(x));

/** Quanto si somigliano due insiemi, da 0 (niente in comune) a 1. */
function jaccard<T>(a: Set<T>, b: Set<T>): number {
  const comuni = intersezione(a, b).length;
  const unione = new Set(Array.from(a).concat(Array.from(b))).size;
  return unione === 0 ? 0 : comuni / unione;
}

/** Tutte le catture di un gruppo. `matchAll` qui non si puo usare: il
 *  tsconfig dei test punta a un target che non lo espone. */
function tutte(testo: string, re: RegExp, gruppo = 1): string[] {
  const out: string[] = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(testo)) !== null) {
    out.push(m[gruppo]);
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}

// ----- estrattori ---------------------------------------------------

const famiglie = (s: Sito): Set<string> =>
  insieme(tutte(s.css, /@font-face\{[\s\S]*?font-family:"([^"]+)"/g));

const paletteHex = (s: Sito): Set<string> => {
  const root = s.css.match(/:root\{[\s\S]*?\n\}/)?.[0] ?? "";
  return insieme(tutte(root, /#([0-9A-Fa-f]{6})/g).map((c) => c.toUpperCase()));
};

const sezioni = (s: Sito): string[] => tutte(s.html, /<section class="([a-z0-9-]+)/g);

const classi = (s: Sito): Set<string> =>
  insieme(
    tutte(s.html, /class="([^"]+)"/g)
      .reduce<string[]>((acc, v) => acc.concat(v.split(/\s+/)), [])
      .filter((c) => c && !c.startsWith("nota-concept") && c !== "salta"),
  );

const easing = (s: Sito): Set<string> =>
  insieme(tutte(s.ts, /ease:\s*"([a-zA-Z0-9.()]+)"/g));

/** I raggi del sito, esclusa la pastiglia "Concept demo": quella e
 *  chrome dello strumento ed e uguale su tutti e quattro per scelta. */
const raggi = (s: Sito): number[] => {
  const css = s.css.replace(/\.nota-concept[^{]*\{[^}]*\}/g, " ");
  return tutte(css, /border-radius:([^;}]+)/g)
    .reduce<number[]>((acc, v) => acc.concat(tutte(v, /(\d+(?:\.\d+)?)px/g).map(Number)), []);
};

const cta = (s: Sito): string => {
  const m = s.html.match(/data-cta[^>]*>([\s\S]*?)<\/a>/) ?? s.html.match(/azione-piena[^>]*>([\s\S]*?)<\/a>/);
  return (m?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

/** Il testo visibile, spogliato di marcatori, script e stili. */
const testo = (s: Sito): string =>
  s.html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ----- i test -------------------------------------------------------

test("diversita: nessuna famiglia di caratteri in comune", () => {
  for (const [a, b] of coppie()) {
    const comuni = intersezione(famiglie(a), famiglie(b));
    assert.deepEqual(comuni, [], `${a.chiave} e ${b.chiave} condividono ${comuni.join(", ")}`);
  }
  for (const s of SITI) {
    assert.ok(famiglie(s).size >= 1, `${s.chiave}: nessun @font-face auto-ospitato`);
  }
});

test("diversita: nessun colore di palette in comune", () => {
  for (const [a, b] of coppie()) {
    const comuni = intersezione(paletteHex(a), paletteHex(b));
    assert.deepEqual(comuni, [], `${a.chiave} e ${b.chiave} condividono i colori ${comuni.join(", ")}`);
  }
});

test("diversita: i fondi sono lontani nello spazio colore", () => {
  // Il fondo e la prima decisione della direzione: se due siti partono
  // dallo stesso campo, il resto e ridipintura.
  //
  // La distanza si misura in tinta, saturazione e chiarezza, non in RGB:
  // un grigio-azzurro chiarissimo e un rosa chiarissimo distano poco in
  // RGB e sono due campi completamente diversi. Basta che una delle tre
  // dimensioni separi.
  const fondo = (s: Sito): { H: number; S: number; L: number; nome: string } => {
    const m = s.css.match(/body\{[\s\S]*?background:\s*var\(--([a-z-]+)\)/);
    const nome = m?.[1];
    const val = nome ? s.css.match(new RegExp(`--${nome}:\\s*(#[0-9A-Fa-f]{6})`))?.[1] : undefined;
    assert.ok(val, `${s.chiave}: non trovo il colore di fondo`);
    const h = val!.slice(1);
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl), d = max - min;
    const L = (max + min) / 2;
    const S = d === 0 ? 0 : d / (1 - Math.abs(2 * L - 1));
    let H = 0;
    if (d !== 0) {
      if (max === r) H = 60 * (((g - bl) / d) % 6);
      else if (max === g) H = 60 * ((bl - r) / d + 2);
      else H = 60 * ((r - g) / d + 4);
    }
    return { H: (H + 360) % 360, S, L, nome: val! };
  };
  for (const [a, b] of coppie()) {
    const [x, y] = [fondo(a), fondo(b)];
    const dh = Math.min(Math.abs(x.H - y.H), 360 - Math.abs(x.H - y.H));
    const dl = Math.abs(x.L - y.L);
    const ds = Math.abs(x.S - y.S);
    assert.ok(dh >= 40 || dl >= 0.18 || ds >= 0.25,
      `${a.chiave} (${x.nome}) e ${b.chiave} (${y.nome}): campi troppo vicini — ` +
      `tinta ${dh.toFixed(0)}°, chiarezza ${dl.toFixed(2)}, saturazione ${ds.toFixed(2)}`);
  }
});

test("diversita: ordine delle sezioni diverso", () => {
  for (const [a, b] of coppie()) {
    const sa = sezioni(a), sb = sezioni(b);
    assert.notDeepEqual(sa, sb, `${a.chiave} e ${b.chiave} hanno la stessa sequenza di sezioni`);
    // Non basta che la sequenza differisca: se i nomi sono gli stessi in
    // ordine diverso e lo stesso impianto rimescolato.
    const comuni = intersezione(insieme(sa), insieme(sb));
    assert.ok(comuni.length <= 1,
      `${a.chiave} e ${b.chiave} riusano le stesse sezioni: ${comuni.join(", ")}`);
  }
});

test("diversita: il vocabolario delle classi non si sovrappone", () => {
  for (const [a, b] of coppie()) {
    const s = jaccard(classi(a), classi(b));
    assert.ok(s < 0.2,
      `${a.chiave} e ${b.chiave}: somiglianza di struttura ${(s * 100).toFixed(0)}% (limite 20%)`);
  }
});

test("diversita: linguaggio del movimento diverso", () => {
  for (const [a, b] of coppie()) {
    const s = jaccard(easing(a), easing(b));
    assert.ok(s < 0.5,
      `${a.chiave} e ${b.chiave} usano le stesse curve: ${intersezione(easing(a), easing(b)).join(", ")}`);
  }
});

test("diversita: geometria diversa", () => {
  // Il raggio massimo dice la famiglia di forme: spigoli vivi, angoli
  // appena smussati, o pastiglie.
  const massimo = (s: Sito) => Math.max.apply(null, [0].concat(raggi(s)));
  const valori = SITI.map((s) => [s.chiave, massimo(s)] as const);
  for (const [a, b] of coppie()) {
    const ma = massimo(a), mb = massimo(b);
    const rapporto = Math.max(ma, mb) / Math.max(1, Math.min(ma, mb));
    assert.ok(rapporto >= 2,
      `${a.chiave} (${ma}px) e ${b.chiave} (${mb}px): stessa famiglia di raggi — ${JSON.stringify(valori)}`);
  }
});

test("diversita: ogni sito ha il suo oggetto identitario", () => {
  const ancore: Record<string, string> = {
    barberia: "rasoio",
    ristorante: "muro",
    dentista: "sezione",
    beauty: "arco",
  };
  for (const s of SITI) {
    const mia = ancore[s.chiave];
    assert.ok(s.css.includes(`.${mia}`), `${s.chiave}: manca l'ancora .${mia}`);
    for (const [altro, classe] of Object.entries(ancore)) {
      if (altro === s.chiave) continue;
      assert.ok(!s.css.includes(`.${classe}{`),
        `${s.chiave} ha ripreso l'ancora .${classe} di ${altro}`);
    }
  }
});

test("diversita: CTA diverse e nel lessico del settore", () => {
  const etichette = SITI.map((s) => cta(s));
  assert.equal(new Set(etichette).size, SITI.length,
    `CTA ripetute: ${JSON.stringify(etichette)}`);
  for (const e of etichette) {
    assert.ok(e.length > 0, "una CTA e vuota");
    assert.ok(!/scopri di piu|contattaci|clicca qui|→/i.test(e), `CTA generica: "${e}"`);
  }
});

test("diversita: densita di testo diversa", () => {
  const densita = SITI.map((s) => {
    const n = sezioni(s).length;
    return [s.chiave, Math.round(testo(s).length / Math.max(1, n))] as const;
  });
  const valori = densita.map((d) => d[1]);
  const spread = Math.max.apply(null, valori) / Math.min.apply(null, valori);
  assert.ok(spread >= 1.5,
    `densita troppo simili fra i quattro siti: ${JSON.stringify(densita)}`);
});

test("copy: nessuna frase da pagina generata, e nessun dato inventato", () => {
  const vietate = [
    "esperienze uniche", "soluzioni su misura", "il tuo partner ideale",
    "passione e professionalita", "passione e professionalità",
    "da sempre al tuo fianco", "eccellenza",
    "un team di professionisti", "nel cuore di", "non solo un",
  ];
  for (const s of SITI) {
    const t = testo(s).toLowerCase();
    for (const v of vietate) {
      assert.ok(!t.includes(v), `${s.chiave}: frase da elenco dei tradimenti — "${v}"`);
    }
  }
});

test("demo: i tre showcase non espongono dati di contatto inventati", () => {
  for (const s of SITI) {
    if (s.chiave === "barberia") continue;   // la barberia usa dati reali verificati
    assert.ok(!/href="tel:/.test(s.html), `${s.chiave}: un numero di telefono inventato`);
    assert.ok(!/<address/.test(s.html), `${s.chiave}: un indirizzo inventato`);
    assert.ok(!/google\.com\/maps/.test(s.html), `${s.chiave}: una posizione inventata`);
    assert.ok(!/\b\d+\s?(?:€|euro)\b/i.test(testo(s)), `${s.chiave}: un prezzo`);
  }
});

test("demo: ogni sito dichiara di essere un concept, ed e noindex", () => {
  for (const s of SITI) {
    assert.ok(/class="nota-concept"/.test(s.html), `${s.chiave}: manca la pastiglia Concept demo`);
    assert.ok(/name="robots" content="noindex/.test(s.html), `${s.chiave}: manca il noindex`);
  }
});

test("movimento: nessun contenuto parcheggiato allo scroll", () => {
  for (const s of SITI) {
    // gsap.from(..., { scrollTrigger }) con opacita o spostamento lascia
    // il testo invisibile o disallineato in uno screenshot a pagina
    // intera, e non lo vede nessun controllo automatico sull'opacita.
    const sospetti = tutte(s.ts, /gsap\.from\(([\s\S]{0,260}?)\)\s*;/g)
      .filter((b) => /scrollTrigger/.test(b));
    assert.deepEqual(sospetti, [], `${s.chiave}: gsap.from legato allo scroll`);
  }
});
