import { turso, isTursoConnected } from "@/lib/turso";
import { geminiJSON } from "@/lib/gemini";
import { launchIntentBrowser, INTENT_USER_AGENT } from "./browser";
import { scrapeAsteBari } from "./scrapers/aste";
import { sendTelegram } from "./notify";
import type { AsteLot, AsteRawLot, AsteScoutResult } from "@/types/intent";

// ============================================================
// ASTE GIUDIZIARIE — sorgente Scout aggiuntiva (immobili
// residenziali, Tribunale di Bari). Riusa il browser Playwright, il
// wrapper Gemini e il sender Telegram del pipeline Intent. Flusso:
//   scrape (Playwright) -> parse+calcolati -> dedup/upsert (Turso)
//   -> scoring Gemini (opzionale) -> digest Telegram giornaliero.
// Nessuna UI. Dedup su tribunale+procedura+lotto.
// ============================================================

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));

// ----- Parsing numerico/date (formato italiano) -----------------

/** "€ 1.234.567,89" / "45.000" / "45000" -> 1234567.89 · null se assente. */
export function parseEuro(s: string): number | null {
  if (!s) return null;
  const m = s.replace(/\s/g, "").match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Primo numero (anche decimale) in una stringa: mq, vani. */
export function parseNum(s: string): number | null {
  if (!s) return null;
  const m = s.replace(/\s/g, "").match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "12/09/2026" / "12-09-2026" -> "2026-09-12" · "" se non valida. */
export function parseItDate(s: string): string {
  const m = s.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (!m) return "";
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const iso = `${m[3]}-${mm}-${dd}`;
  return Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) ? iso : "";
}

/** Giorni interi da oggi (UTC) al termine (negativo = scaduto). */
export function daysUntil(iso: string, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((t - today) / 86_400_000);
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Chiave dedup: tribunale|procedura|lotto normalizzati. */
export function asteKey(tribunale: string, procedura: string, lotto: string): string {
  return `${norm(tribunale)}|${norm(procedura)}|${norm(lotto)}`;
}

/** Estrae un campo: valore strutturato se presente, altrimenti la
 *  prima regex che matcha su raw_text. */
function pick(structured: string, rawText: string, patterns: RegExp[]): string {
  if (structured && structured.trim()) return structured.trim();
  for (const re of patterns) {
    const m = rawText.match(re);
    if (m) return (m[1] ?? m[0]).trim();
  }
  return "";
}

/** Normalizza un lotto grezzo in AsteLot con i campi calcolati. */
export function parseAsteLot(raw: AsteRawLot, now = new Date()): AsteLot {
  const t = raw.raw_text || "";
  const tribunale = (raw.tribunale || pick("", t, [/tribunale\s+di\s+([A-Za-zÀ-ù' ]+)/i]) || "Bari").trim();
  const procedura = pick(raw.procedura, t, [
    /(?:proc(?:edura)?\.?|esec(?:uzione)?\.?|r\.?g\.?e\.?)\s*(?:n\.?|immobiliare)?\s*([0-9]+\s*\/\s*[0-9]{2,4})/i,
    /\bn\.?\s*([0-9]+\s*\/\s*[0-9]{2,4})\b/,
  ]).replace(/\s+/g, "");
  const lotto = pick(raw.lotto, t, [/lotto\s*(?:n\.?|unico)?\s*([0-9]+|unico)/i]);
  const comune = pick(raw.comune, t, [
    /comune\s*(?:di)?\s*:?\s*([A-Za-zÀ-ù'’ ]+?)\s*(?:[(,\n]|\s-|\d|$)/i,
    /(?:sito in|ubicat[oa] in|immobile in)\s+([A-Za-zÀ-ù'’ ]{2,}?)\s*(?:[(,\n]|\s-|\d|$)/i,
  ]).replace(/\s+/g, " ").trim();
  const tipo = pick(raw.tipo, t, [
    /\b(appartamento|villa(?:\s+singola|\s+a schiera)?|villetta|abitazione|casa(?:\s+indipendente)?|immobile residenziale|bilocale|trilocale|quadrilocale|monolocale|attico|mansarda)\b/i,
  ]);
  const mq = parseNum(pick(raw.mq, t, [/(\d+(?:[.,]\d+)?)\s*(?:mq|m²|metri quadr)/i, /superficie[^0-9]*(\d+(?:[.,]\d+)?)/i]));
  const vani = parseNum(pick(raw.vani, t, [/(\d+)\s*vani/i, /vani\s*:?\s*(\d+)/i, /(\d+)\s*local[ie]/i]));
  const offerta_minima = parseEuro(pick(raw.offerta_minima, t, [
    /offerta\s*minima[^0-9]*([0-9][0-9.,]*)/i,
    /prezzo\s*base[^0-9]*([0-9][0-9.,]*)/i,
    /base\s*d['’]?asta[^0-9]*([0-9][0-9.,]*)/i,
  ]));
  const valore_stima = parseEuro(pick(raw.valore_stima, t, [
    /(?:valore|stima|perizia)[^0-9]*([0-9][0-9.,]*)/i,
    /valore\s*di\s*stima[^0-9]*([0-9][0-9.,]*)/i,
  ]));
  const data_asta = parseItDate(pick(raw.data_asta, t, [
    /(?:data\s*(?:vendita|asta)|vendita\s*(?:il|del)?|asta\s*(?:il|del)?)[^0-9]*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4})/i,
  ]));
  const termine_offerte = parseItDate(pick(raw.termine_offerte, t, [
    /termine[^0-9]*(?:present\w*)?[^0-9]*offert[^0-9]*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4})/i,
    /offert[ea][^0-9]*entro[^0-9]*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4})/i,
  ]));

  const risparmio_pct =
    valore_stima != null && valore_stima > 0 && offerta_minima != null
      ? Math.max(0, (valore_stima - offerta_minima) / valore_stima)
      : null;

  return {
    key: asteKey(tribunale, procedura, lotto),
    tribunale,
    procedura,
    lotto,
    comune,
    tipo,
    mq,
    vani,
    offerta_minima,
    valore_stima,
    data_asta,
    termine_offerte,
    link: raw.link,
    risparmio_pct,
    giorni_al_termine: daysUntil(termine_offerte, now),
  };
}

// ----- Persistenza / dedup (Turso, auto-migrata) -----------------

let asteSchemaEnsured = false;

export async function ensureAsteSchema(): Promise<void> {
  if (!turso || asteSchemaEnsured) return;
  await turso.executeMultiple(`
    create table if not exists aste_lots (
      key             text primary key,
      tribunale       text default '',
      procedura       text default '',
      lotto           text default '',
      comune          text default '',
      tipo            text default '',
      mq              real,
      vani            real,
      offerta_minima  real,
      valore_stima    real,
      data_asta       text default '',
      termine_offerte text default '',
      link            text default '',
      risparmio_pct   real,
      gemini_score    integer default 0,
      gemini_nota     text default '',
      first_seen      text default (datetime('now')),
      updated_at      text default (datetime('now'))
    );
    create index if not exists idx_aste_risparmio on aste_lots(risparmio_pct);
    create index if not exists idx_aste_termine on aste_lots(termine_offerte);
  `);
  asteSchemaEnsured = true;
}

async function knownAsteKeys(): Promise<Set<string>> {
  if (!turso) return new Set();
  const res = await turso.execute("select key from aste_lots");
  return new Set((res.rows as Row[]).map((r) => str(r.key)));
}

/** Upsert su chiave: aggiorna prezzi/date/calcolati a ogni scan,
 *  mantenendo first_seen. */
async function upsertAsteLot(lot: ScoredLot): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `insert into aste_lots
            (key, tribunale, procedura, lotto, comune, tipo, mq, vani,
             offerta_minima, valore_stima, data_asta, termine_offerte, link,
             risparmio_pct, gemini_score, gemini_nota)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(key) do update set
            comune = excluded.comune,
            tipo = excluded.tipo,
            mq = excluded.mq,
            vani = excluded.vani,
            offerta_minima = excluded.offerta_minima,
            valore_stima = excluded.valore_stima,
            data_asta = excluded.data_asta,
            termine_offerte = excluded.termine_offerte,
            link = case when excluded.link != '' then excluded.link else aste_lots.link end,
            risparmio_pct = excluded.risparmio_pct,
            gemini_score = excluded.gemini_score,
            gemini_nota = excluded.gemini_nota,
            updated_at = datetime('now')`,
    args: [
      lot.key, lot.tribunale, lot.procedura, lot.lotto, lot.comune, lot.tipo,
      lot.mq, lot.vani, lot.offerta_minima, lot.valore_stima, lot.data_asta,
      lot.termine_offerte, lot.link, lot.risparmio_pct,
      lot.gemini_score ?? 0, lot.gemini_nota ?? "",
    ] as (string | number | null)[],
  });
}

// AsteLot arricchito con lo scoring Gemini opzionale.
type ScoredLot = AsteLot & { gemini_score?: number; gemini_nota?: string };

// ----- Scoring Gemini (opzionale, una sola chiamata batch) -------

/** Riusa geminiJSON per assegnare a ogni lotto un punteggio di
 *  appeal 0-100 (sconto, tipologia, dimensione). UNA chiamata per
 *  run; se GEMINI_API_KEY manca o fallisce, ritorna mappa vuota
 *  (l'ordinamento resta su risparmio_pct). */
async function scoreWithGemini(lots: AsteLot[]): Promise<Map<string, { score: number; nota: string }>> {
  const out = new Map<string, { score: number; nota: string }>();
  if (lots.length === 0) return out;
  const subset = lots.slice(0, 25); // limita i token
  const system =
    "Sei un analista di aste immobiliari. Valuta ogni lotto per appetibilità " +
    "d'investimento 0-100 (sconto sul valore di stima, tipologia residenziale, " +
    "dimensione). Nota di max 6 parole. Rispondi SOLO con JSON: " +
    '{"lotti":[{"key":"...","score":0,"nota":"..."}]}';
  const user = subset
    .map((l) =>
      `key=${l.key} | ${l.comune} ${l.tipo} ${l.mq ?? "?"}mq | ` +
      `offerta ${l.offerta_minima ?? "?"} stima ${l.valore_stima ?? "?"} | ` +
      `risparmio ${l.risparmio_pct != null ? Math.round(l.risparmio_pct * 100) + "%" : "?"}`,
    )
    .join("\n");
  const res = await geminiJSON<{ lotti: { key: string; score: number; nota: string }[] }>(system, user);
  for (const r of res?.lotti ?? []) {
    if (typeof r.key === "string") {
      out.set(r.key, {
        score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
        nota: str(r.nota).slice(0, 60),
      });
    }
  }
  return out;
}

// ----- Digest Telegram -------------------------------------------

const MAX_CARDS = 12;
const URGENT_DAYS = 7;

const euroFmt = (n: number | null): string =>
  n == null ? "n/d" : `€${Math.round(n).toLocaleString("it-IT")}`;
const itDateFmt = (iso: string): string => {
  if (!iso) return "n/d";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Ordina per risparmio_pct desc (null in fondo), tiebreak punteggio
 *  Gemini poi valore. Top 3 -> 🔥. Termine <= 7gg -> ⚠️. */
export function buildAsteDigest(lots: ScoredLot[], now = new Date()): string {
  if (lots.length === 0) return "";
  const sorted = [...lots].sort((a, b) => {
    const ra = a.risparmio_pct ?? -1;
    const rb = b.risparmio_pct ?? -1;
    if (rb !== ra) return rb - ra;
    const ga = a.gemini_score ?? 0;
    const gb = b.gemini_score ?? 0;
    if (gb !== ga) return gb - ga;
    return (b.valore_stima ?? 0) - (a.valore_stima ?? 0);
  });

  const shown = sorted.slice(0, MAX_CARDS);
  const dateHeader = new Intl.DateTimeFormat("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome",
  }).format(now);

  const lines: string[] = [
    `🏛️ ASTE GIUDIZIARIE — Tribunale di Bari (residenziale)`,
    `${dateHeader} · ${sorted.length} lotti`,
    "",
  ];

  shown.forEach((l, i) => {
    const fire = i < 3 ? "🔥 " : "";
    const urgent =
      l.giorni_al_termine != null && l.giorni_al_termine >= 0 && l.giorni_al_termine <= URGENT_DAYS;
    const risparmio = l.risparmio_pct != null ? `${Math.round(l.risparmio_pct * 100)}%` : "n/d";
    const mqTxt = l.mq != null ? `, ${l.mq} mq` : "";
    const comune = l.comune || "—";
    const tipo = l.tipo || "immobile";

    let termine = `Termine offerte: ${itDateFmt(l.termine_offerte)}`;
    if (l.giorni_al_termine != null) {
      termine +=
        l.giorni_al_termine >= 0
          ? ` (tra ${l.giorni_al_termine} giorni)`
          : ` (SCADUTO)`;
    }
    if (urgent) termine += " ⚠️";

    lines.push(`${fire}${comune.toUpperCase()} — ${tipo}${mqTxt}`);
    lines.push(`Offerta minima: ${euroFmt(l.offerta_minima)}`);
    lines.push(`Valore perizia: ${euroFmt(l.valore_stima)}`);
    lines.push(`Risparmio: ${risparmio}`);
    lines.push(`Asta: ${itDateFmt(l.data_asta)}`);
    lines.push(termine);
    if (l.link) lines.push(`🔗 ${l.link}`);
    lines.push("");
  });

  if (sorted.length > shown.length) {
    lines.push(`+${sorted.length - shown.length} altri lotti (ordina per risparmio).`);
  }
  return lines.join("\n").trim();
}

// ----- Orchestratore ---------------------------------------------

async function scrapeLots(result: AsteScoutResult): Promise<AsteRawLot[]> {
  const browser = await launchIntentBrowser();
  try {
    const ctx = await browser.newContext({ userAgent: INTENT_USER_AGENT, locale: "it-IT" });
    const page = await ctx.newPage();
    try {
      return await scrapeAsteBari(page);
    } catch (err) {
      result.errors.push(`aste: ${(err as Error).message}`);
      console.error("[aste/scout] scraper fallito —", (err as Error).message);
      return [];
    }
  } finally {
    try {
      await browser.close();
    } catch (err) {
      console.error("[aste/scout] browser.close fallito:", (err as Error).message);
    }
  }
}

/** Filtra i lotti residenziali con abbastanza dati per essere utili. */
function isUsable(lot: AsteLot): boolean {
  // serve almeno l'offerta minima e un comune o un link per essere una scheda vera
  return lot.offerta_minima != null && (lot.comune !== "" || lot.link !== "");
}

export async function runAsteScout(now = new Date()): Promise<AsteScoutResult> {
  if (!isTursoConnected()) {
    throw new Error("Turso non configurato: lo scout aste richiede il DB.");
  }
  await ensureAsteSchema();

  const result: AsteScoutResult = {
    scraped: 0,
    nuovi: 0,
    aggiornati: 0,
    digest_inviato: false,
    lotti_in_digest: 0,
    errors: [],
  };

  const raw = await scrapeLots(result);
  result.scraped = raw.length;

  const parsed = raw.map((r) => parseAsteLot(r, now)).filter(isUsable);

  // Scoring Gemini (opzionale) + dedup/upsert
  const geminiScores = await scoreWithGemini(parsed).catch(() => new Map());
  const known = await knownAsteKeys();
  const scored: ScoredLot[] = [];
  const seen = new Set<string>();
  for (const lot of parsed) {
    if (seen.has(lot.key)) continue; // dedup in-run
    seen.add(lot.key);
    const g = geminiScores.get(lot.key);
    const s: ScoredLot = { ...lot, gemini_score: g?.score ?? 0, gemini_nota: g?.nota ?? "" };
    scored.push(s);
    if (known.has(lot.key)) result.aggiornati++;
    else result.nuovi++;
    try {
      await upsertAsteLot(s);
    } catch (err) {
      result.errors.push(`upsert ${lot.key}: ${(err as Error).message}`);
    }
  }

  // Digest giornaliero: tutti i lotti aperti trovati, ordinati.
  const digest = buildAsteDigest(scored, now);
  if (digest) {
    result.lotti_in_digest = Math.min(scored.length, MAX_CARDS);
    result.digest_inviato = await sendTelegram(digest);
  } else if (result.errors.length > 0) {
    // Nessun lotto E c'è stato un errore (blocco/anti-bot): avvisa che
    // lo scout non ha prodotto nulla, senza restare in silenzio.
    result.digest_inviato = await sendTelegram(
      `🏛️ Aste giudiziarie (Bari): nessun lotto estratto. ${result.errors[0]}`,
    );
  }

  return result;
}
