import type { VoiceCommand } from "@/types/voice";

// ============================================================
// Local regex command parser (no AI — instant). Italian, fuzzy,
// colloquial. Order matters: specific → generic. Tolerant of
// typos (Levenshtein on cities + categories) and filler words.
// ============================================================

const CATEGORY_ALIASES: Record<string, string> = {
  parrucchiere: "parrucchiere",
  barbiere: "barbiere",
  estetista: "estetista",
  tattoo: "tattoo studio",
  palestra: "palestra",
  ristorante: "ristorante",
  pizzeria: "pizzeria",
  bar: "bar",
  dentista: "dentista",
  avvocato: "avvocato",
  commercialista: "commercialista",
  trattoria: "ristorante",
  osteria: "ristorante",
  enoteca: "bar",
  "wine bar": "bar",
  caffetteria: "bar",
  caffe: "bar",
  "studio legale": "avvocato",
  architetto: "avvocato",
  // Plurals
  parrucchieri: "parrucchiere",
  barbieri: "barbiere",
  estetiste: "estetista",
  tatuatori: "tattoo studio",
  "tattoo studio": "tattoo studio",
  "studio tattoo": "tattoo studio",
  palestre: "palestra",
  ristoranti: "ristorante",
  pizzerie: "pizzeria",
  dentisti: "dentista",
  avvocati: "avvocato",
  commercialisti: "commercialista",
  // Variants
  parrucchieria: "parrucchiere",
  saloni: "parrucchiere",
  salone: "parrucchiere",
  "salone di bellezza": "estetista",
  barbieria: "barbiere",
  "centro estetico": "estetista",
  "centri estetici": "estetista",
  gym: "palestra",
  fitness: "palestra",
  "personal trainer": "palestra",
  "pizzeria napoletana": "pizzeria",
};

const TOP_CITIES = [
  "milano", "roma", "torino", "napoli", "firenze", "bologna", "verona", "padova",
  "bari", "catania", "genova", "palermo", "lecce", "pescara", "ancona", "trieste",
  "trento", "modena", "rimini", "ravenna", "ferrara", "forli", "cesena", "faenza",
  "imola", "carpi", "reggio emilia", "parma", "piacenza", "cremona", "mantova",
  "brescia", "bergamo", "como", "varese", "novara", "alessandria", "asti", "cuneo",
  "savona", "sanremo", "la spezia", "livorno", "pisa", "lucca", "siena", "arezzo",
  "perugia", "terni", "foligno", "spoleto", "orvieto", "gubbio", "assisi", "viterbo",
  "latina", "frosinone", "rieti", "l'aquila", "chieti", "campobasso", "isernia",
  "benevento", "avellino", "caserta", "salerno", "foggia", "andria", "barletta",
  "trani", "brindisi", "taranto", "matera", "potenza", "cosenza", "catanzaro",
  "reggio calabria", "messina", "siracusa", "ragusa", "enna", "caltanissetta",
  "agrigento", "trapani", "sassari", "olbia", "nuoro", "oristano", "cagliari",
];

function levenshtein(a: string, b: string): number {
  const m: number[][] = Array.from({ length: b.length + 1 }, () =>
    new Array<number>(a.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) m[0][i] = i;
  for (let j = 0; j <= b.length; j++) m[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[j][i] = Math.min(m[j][i - 1] + 1, m[j - 1][i] + 1, m[j - 1][i - 1] + cost);
    }
  }
  return m[b.length][a.length];
}

function normalizeCity(input: string): string | null {
  const n = input
    .toLowerCase()
    .trim()
    .replace(/^(a|ad|in|per|di|da|del|della|al|alla|nel|nella)\s+/i, "")
    .replace(/[^a-zàèéìòù\s']/g, "")
    .trim();
  if (!n) return null;
  if (TOP_CITIES.includes(n)) return n;
  let best: string | null = null;
  let bestD = 3;
  for (const city of TOP_CITIES) {
    const d = levenshtein(n, city);
    if (d < bestD) {
      bestD = d;
      best = city;
    }
  }
  if (best) return best;
  const partial = TOP_CITIES.find(
    (c) => c.startsWith(n) || (n.length >= 4 && n.startsWith(c)),
  );
  return partial ?? null;
}

interface CategoryResult {
  value: string | null;
  corrected: boolean;
}

function normalizeCategory(raw: string): CategoryResult {
  const r = raw
    .toLowerCase()
    .trim()
    .replace(/^(un|uno|una|dei|delle|degli|dello|della|il|lo|la|i|le|gli)\s+/i, "")
    .replace(/[^a-zàèéìòù\s]/g, "")
    .trim();
  if (!r) return { value: null, corrected: false };
  if (CATEGORY_ALIASES[r]) {
    return { value: CATEGORY_ALIASES[r], corrected: CATEGORY_ALIASES[r] !== r };
  }
  const variants = [r.replace(/i$/, "e"), r.replace(/e$/, "a"), r.replace(/i$/, "a")];
  for (const v of variants) {
    if (CATEGORY_ALIASES[v]) return { value: CATEGORY_ALIASES[v], corrected: true };
  }
  let best: string | null = null;
  let bestD = 3;
  for (const key of Object.keys(CATEGORY_ALIASES)) {
    const d = levenshtein(r, key);
    if (d < bestD) {
      bestD = d;
      best = CATEGORY_ALIASES[key];
    }
  }
  return best ? { value: best, corrected: true } : { value: null, corrected: false };
}

// ---------- Browser commands ----------

interface BrowserCommand {
  pattern: RegExp;
  url: (q?: string) => string;
  name: string;
}

const enc = encodeURIComponent;

const BROWSER_COMMANDS: BrowserCommand[] = [
  {
    pattern: /(?:cerca|trova|guarda|metti|suona|play|fammi vedere)\s+(?:su\s+)?youtube\s+(.+)/i,
    url: (q) => `https://www.youtube.com/results?search_query=${enc(q ?? "")}`,
    name: "YouTube",
  },
  {
    pattern: /(?:cerca|trova|metti|suona|play|ascolta)\s+(?:su\s+)?spotify\s+(.+)/i,
    url: (q) => `https://open.spotify.com/search/${enc(q ?? "")}`,
    name: "Spotify",
  },
  {
    pattern: /(?:cerca su google|google|googla)\s+(.+)/i,
    url: (q) => `https://www.google.com/search?q=${enc(q ?? "")}`,
    name: "Google",
  },
  {
    pattern: /(?:apri|vai su|portami su)\s+(?:il\s+)?(?:calendar|calendario|agenda)\b/i,
    url: () => "https://calendar.google.com",
    name: "Google Calendar",
  },
  {
    pattern: /(?:apri|vai su|portami su)\s+(?:la\s+)?(?:gmail|mail|posta|email)\b/i,
    url: () => "https://mail.google.com",
    name: "Gmail",
  },
  {
    pattern: /(?:apri|vai su|portami su)\s+(?:il\s+)?(?:google\s+)?drive\b/i,
    url: () => "https://drive.google.com",
    name: "Google Drive",
  },
  {
    pattern: /(?:apri|vai su|portami su)\s+(?:le\s+|il\s+)?(?:google\s+)?(?:maps|mappe)\b/i,
    url: () => "https://maps.google.com",
    name: "Google Maps",
  },
  {
    pattern: /(?:che tempo fa|meteo|previsioni)(?:\s+(?:a|di|per))?\s*([a-zàèéìòù'\s]+)?/i,
    url: (q) =>
      q && q.trim()
        ? `https://www.google.com/search?q=meteo+${enc(q.trim())}`
        : "https://www.google.com/search?q=meteo",
    name: "Meteo",
  },
];

function parseBrowserCommand(t: string): VoiceCommand | null {
  for (const cmd of BROWSER_COMMANDS) {
    const match = t.match(cmd.pattern);
    if (match) {
      const query = match[1]?.trim();
      return {
        type: "browser",
        payload: { url: cmd.url(query), target: "_blank", name: cmd.name },
        responseText: `Apro ${cmd.name}${query ? ` per "${query}"` : ""}.`,
      };
    }
  }
  return null;
}

// ---------- Hunter ----------

const HUNT_VERBS =
  "(?:hunter|cerca|cercami|trova|trovami|dammi|cacciami|caccia|mostrami)";

function huntCommand(rawCat: string, rawCity: string): VoiceCommand {
  const cat = normalizeCategory(rawCat);
  const city = normalizeCity(rawCity);
  if (!city) {
    return {
      type: "unknown",
      payload: {},
      responseText: `Mmm, la città non l'ho colta. Hai detto "${rawCity.trim()}"? Prova con Milano, Roma, Bari, Napoli, Torino...`,
    };
  }
  const category = cat.value ?? rawCat.trim();
  const corrected = cat.corrected || rawCity.trim().toLowerCase() !== city;
  return {
    type: "hunt",
    payload: { category, city },
    responseText: corrected
      ? `Capito, cerco ${category} a ${city}.`
      : `Ok, lancio Hunter per ${category} a ${city}.`,
  };
}

// Specific: verb + category + preposition + city ("cerca parrucchiere a milano").
function parseHunterPrep(t: string): VoiceCommand | null {
  const withPrep = t.match(
    new RegExp(
      `${HUNT_VERBS}\\s+(?:un\\s+|uno\\s+|una\\s+|dei\\s+|delle\\s+|degli\\s+)?([a-zàèéìòù'\\s]+?)\\s+(?:a|in|ad|nella|nel|su|verso)\\s+([a-zàèéìòù'\\s]+)$`,
      "i",
    ),
  );
  return withPrep ? huntCommand(withPrep[1], withPrep[2]) : null;
}

// Loose: optional verb + "category city" (last word = city). Runs LATE so it
// never hijacks keyword commands (cerca lead / genera / leggi ...).
function parseHunterBare(t: string): VoiceCommand | null {
  const stripped = t
    .replace(
      new RegExp(
        `^${HUNT_VERBS}\\s+(?:un\\s+|uno\\s+|una\\s+|dei\\s+|delle\\s+|degli\\s+|il\\s+|lo\\s+|la\\s+|i\\s+|le\\s+|gli\\s+|mi\\s+)*`,
        "i",
      ),
      "",
    )
    .trim();
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  const city = normalizeCity(words[words.length - 1]);
  if (!city) return null;
  const cat = normalizeCategory(words.slice(0, -1).join(" "));
  if (!cat.value) return null;
  return {
    type: "hunt",
    payload: { category: cat.value, city },
    responseText: `Capito, cerco ${cat.value} a ${city}.`,
  };
}

// ---------- Navigation ----------

const MODULE_ROUTES: Record<string, { route: string; label: string }> = {
  visor: { route: "/visor", label: "Visor" },
  cockpit: { route: "/cockpit", label: "Cockpit" },
  hunter: { route: "/hunter", label: "Hunter" },
  hand: { route: "/hand", label: "Hand" },
  whisper: { route: "/whisper", label: "Whisper" },
  oracle: { route: "/oracle", label: "Oracle" },
  territorio: { route: "/territorio", label: "Territorio" },
  mappa: { route: "/territorio", label: "Territorio" },
  mappe: { route: "/territorio", label: "Territorio" },
  forecast: { route: "/forecast", label: "Forecast" },
  cassa: { route: "/forecast", label: "Forecast" },
  deals: { route: "/visor", label: "Visor" },
  pipeline: { route: "/visor", label: "Visor" },
  home: { route: "/cockpit", label: "Cockpit" },
  dashboard: { route: "/cockpit", label: "Cockpit" },
};

function clean(s: string): string {
  return s.replace(/[.?!,;:]+$/g, "").trim();
}
function titleCase(s: string): string {
  return s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

export function parseCommand(transcript: string): VoiceCommand {
  const t = transcript
    .toLowerCase()
    .trim()
    .replace(/^(ehm|uhm|allora|dunque|guarda|senti|scusa|per favore|per piacere|tipo|cioè|ecco)\s+/i, "")
    .trim();
  if (!t) return { type: "unknown", payload: {}, responseText: "Non ho sentito nulla." };

  // 1. Stop / silence.
  if (/^(stop|basta|silenzio|quieto|zitto|pausa|stoppa|fermati|ferma)\b/.test(t)) {
    return { type: "control", payload: {}, responseText: "" };
  }

  // 2. Browser (explicit services).
  const browser = parseBrowserCommand(t);
  if (browser) return browser;

  // 3. Hunter with preposition (specific).
  const huntPrep = parseHunterPrep(t);
  if (huntPrep) return huntPrep;

  // 4. Lead search.
  let m = t.match(/(?:cerca|trova)\s+(?:il\s+)?lead\s+(.+)/);
  if (m) {
    const q = clean(m[1]);
    return {
      type: "search",
      payload: { query: q },
      responseText: `Cerco "${titleCase(q)}" nei lead.`,
    };
  }

  // 5. Lead filter (colloquial → funnel status).
  m = t.match(
    /(?:mostra|filtra)\s+(?:i\s+)?lead\s+(da contattare|contattare|nuovi|inviati|risposti|risposto|preview|trattativa|chiusi|persi|lost|aperti)/,
  );
  if (m) {
    const map: Record<string, string> = {
      "da contattare": "todo",
      contattare: "todo",
      nuovi: "todo",
      inviati: "step1_sent",
      risposti: "replied",
      risposto: "replied",
      preview: "preview_sent",
      trattativa: "negotiating",
      chiusi: "closed",
      persi: "lost",
      lost: "lost",
      aperti: "replied",
    };
    return {
      type: "filter",
      payload: { status: map[m[1]] ?? m[1] },
      responseText: `Filtro i lead ${m[1]}.`,
    };
  }

  // 6. Generate proposal.
  m = t.match(/(?:genera|prepara|crea|fai)\s+(?:una\s+)?(?:proposta|offerta)\s+(?:per\s+)?(.+)/);
  if (m) {
    const name = clean(m[1]);
    if (name) {
      return {
        type: "generate",
        payload: { leadName: name },
        responseText: `Preparo la proposta per ${titleCase(name)}.`,
      };
    }
  }
  if (/\bnuova\s+proposta\b/.test(t)) {
    return { type: "navigate", payload: { route: "/hand" }, responseText: "Apro il generatore proposte." };
  }

  // 7. Simulate scenario.
  m = t.match(/(?:simula|calcola)\s+(?:lo\s+)?(?:scenario|probabilit[àa])\s+(?:di\s+chiusura\s+)?(?:per\s+)?(.+)/);
  if (m) {
    const name = clean(m[1]);
    if (name) {
      return {
        type: "simulate",
        payload: { leadName: name },
        responseText: `Simulo lo scenario per ${titleCase(name)}.`,
      };
    }
  }

  // 8. Read aloud.
  m = t.match(/(?:leggi|leggimi|dimmi)\s+(?:l['’]\s*|il\s+|la\s+)?(insight|script|proposta|testo|risultato|tutto)/);
  if (m) {
    return { type: "read", payload: { section: m[1] }, responseText: "" };
  }

  // 9. Mind scan / Whisper shadow.
  if (/\bscan(?:siona)?\s+(?:network|rete)\b/.test(t)) {
    return { type: "action", payload: { module: "mind", kind: "scan" }, responseText: "Scansiono la rete." };
  }
  if (/\bshadow\s+mode\b/.test(t) || /\bmodalit[àa]\s+ombra\b/.test(t)) {
    return { type: "action", payload: { module: "whisper", kind: "shadow" }, responseText: "Attivo lo Shadow Mode." };
  }
  if (/\baggiorna\s+(?:il\s+)?(?:visor|lead|pipeline)\b/.test(t)) {
    return { type: "action", payload: { module: "visor", kind: "refresh" }, responseText: "Aggiorno il Visor." };
  }

  // 10. Navigation.
  m = t.match(/(?:apri|vai|portami|mostra|fammi vedere|avvia|attiva|torna)\s+(?:a|su|al|alla|in|il|la|lo)?\s*([a-zàèéìòù]+)/);
  if (m && MODULE_ROUTES[m[1]]) {
    const { route, label } = MODULE_ROUTES[m[1]];
    return { type: "navigate", payload: { route }, responseText: `Ci sono, apro ${label}.` };
  }
  if (/^(?:torna|indietro|dashboard|home)\b/.test(t)) {
    return { type: "navigate", payload: { route: "/visor" }, responseText: "Torno al Visor." };
  }

  // 10b. Bare "categoria città" — last, so keyword commands win.
  const huntBare = parseHunterBare(t);
  if (huntBare) return huntBare;

  // 11. Wake.
  if (/^(ciao|hey|ehi|ok\s+spectre|spectre|mi senti|ci sei)\b/.test(t)) {
    return { type: "wake", payload: {}, responseText: "Sono qui. Che facciamo?" };
  }

  // 12. Help.
  if (/^(aiuto|help|comandi|cosa posso dire|che comandi|non so cosa dire|non capisco)/.test(t)) {
    return { type: "help", payload: {}, responseText: "" };
  }

  return {
    type: "unknown",
    payload: {},
    responseText: `Non ho capito "${transcript.trim()}". Prova in un altro modo, o dimmi "Aiuto" per i comandi.`,
  };
}
