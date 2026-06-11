import { geminiJSON } from "@/lib/gemini";
import type {
  DetectiveAnalysis,
  DetectiveCase,
  DetectiveLoss,
  DetectiveRawData,
  DetectiveScores,
} from "@/types/detective";
import benchmarks from "./benchmarks.json";

// ============================================================
// DETECTIVE analyze — Gemini Flash (stack bloccato) su raw_data
// + benchmarks.json. Output validato in codice:
// - ogni perdita DEVE citare fact id realmente raccolti, le altre
//   vengono scartate (anti-hallucination)
// - automazioni solo dal catalogo (nome+beneficio, MAI prezzi)
// - stime SEMPRE a range min-max, totale calcolato in codice
// ============================================================

const SCORE_KEYS: (keyof DetectiveScores)[] = [
  "visibilita",
  "reattivita",
  "recupero_clienti",
  "reputazione",
  "prenotabilita",
];

/** Tetto di sanità per singola perdita (€/mese): un salone di zona
 *  non "perde" 20k/mese per un form mancante. */
const LOSS_MAX_CAP = 4000;
const MAX_LOSSES = 7;

const ANALYZE_SYSTEM_PROMPT = `Sei l'analista DETECTIVE di AYROMEX. Ricevi i dati PUBBLICI raccolti su un salone/centro estetico pugliese (fatti verificati F1..Fn, recensioni recenti, benchmark di settore) e produci il dossier "dove stai perdendo soldi".

REGOLE FERREE:
1. Puoi usare SOLO i fatti F1..Fn forniti. Ogni perdita deve citare i fact id su cui si basa nel campo "fact_ids". Se un dato non c'è tra i fatti, quella perdita NON esiste.
2. Stime SEMPRE a range min-max in euro/mese, derivate dai benchmark forniti, con le assunzioni dichiarate in "assumptions". MAI numeri secchi, MAI promesse: linguaggio "stima/potenziale".
3. Massimo ${MAX_LOSSES} perdite, ordinate dalla più concreta. Meglio 3 perdite solide che 7 deboli.
4. Per ogni perdita scegli UNA automazione dal catalogo fornito, copiando ESATTAMENTE il campo "name". Niente prezzi.
5. I 5 score (0-100) valutano: visibilita (presenza/qualità online), reattivita (canali di risposta rapida), recupero_clienti (strumenti per far tornare i clienti), reputazione (gestione recensioni), prenotabilita (facilità di prenotare).
6. Tono professionale e concreto, in italiano. Le evidenze devono essere frasi verificabili, ricalcate sui fatti.

Rispondi SOLO con JSON:
{
  "scores": {"visibilita":0-100,"reattivita":0-100,"recupero_clienti":0-100,"reputazione":0-100,"prenotabilita":0-100},
  "losses": [{"title":"...","evidence":"...","fact_ids":["F1"],"automation_name":"<dal catalogo>","monthly_min":N,"monthly_max":N}],
  "assumptions": ["..."],
  "wa_hook": "la perdita più concreta in UNA frase colloquiale, per aggancio WhatsApp"
}`;

interface GeminiAnalyzeOut {
  scores?: Partial<DetectiveScores>;
  losses?: {
    title?: string;
    evidence?: string;
    fact_ids?: string[];
    automation_name?: string;
    monthly_min?: number;
    monthly_max?: number;
  }[];
  assumptions?: string[];
  wa_hook?: string;
}

const clamp = (n: unknown, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

function buildWaMessage(c: DetectiveCase, hook: string, reportUrl: string): string {
  return (
    `Buongiorno! Ho fatto un'analisi gratuita di ${c.business_name} basata solo su dati pubblici (sito + Google). ` +
    `Una cosa che salta all'occhio: ${hook} ` +
    `Il dossier completo è qui: ${reportUrl} — se le va, le offro un approfondimento gratuito senza impegno. Christian, AYROMEX`
  );
}

export async function analyzeCase(
  c: DetectiveCase,
  raw: DetectiveRawData,
  reportUrl: string,
): Promise<DetectiveAnalysis | null> {
  const vertical = c.category.includes("estetic") ? "estetica" : "salone";

  const userPrompt = JSON.stringify({
    attivita: c.business_name,
    categoria: c.category,
    verticale: vertical,
    zona: c.city,
    fatti: raw.facts,
    recensioni_recenti: raw.gbp?.recent_reviews ?? [],
    benchmarks,
  });

  const out = await geminiJSON<GeminiAnalyzeOut>(
    ANALYZE_SYSTEM_PROMPT,
    userPrompt,
    { complex: true, temperature: 0.4, maxOutputTokens: 4096 },
  );
  if (!out) return null;

  // ----- validazione score -----
  const scores = Object.fromEntries(
    SCORE_KEYS.map((k) => [k, clamp(out.scores?.[k], 0, 100)]),
  ) as unknown as DetectiveScores;
  const overall = Math.round(
    SCORE_KEYS.reduce((sum, k) => sum + scores[k], 0) / SCORE_KEYS.length,
  );

  // ----- validazione perdite (anti-hallucination) -----
  const validFactIds = new Set(raw.facts.map((f) => f.id));
  const catalog = new Map(
    benchmarks.automation_catalog.map((a) => [a.name.toLowerCase(), a]),
  );

  const losses: DetectiveLoss[] = [];
  for (const l of out.losses ?? []) {
    if (losses.length >= MAX_LOSSES) break;
    const factIds = (l.fact_ids ?? []).filter((id) => validFactIds.has(id));
    // Senza almeno un fatto reale la perdita non si scrive.
    if (factIds.length === 0 || !l.title || !l.evidence) continue;

    const automation = catalog.get((l.automation_name ?? "").toLowerCase());
    if (!automation) continue; // fuori catalogo: scartata

    let min = clamp(l.monthly_min, 0, LOSS_MAX_CAP);
    let max = clamp(l.monthly_max, 0, LOSS_MAX_CAP);
    if (max < min) [min, max] = [max, min];
    if (max === 0) continue; // perdita senza stima: non è una perdita

    losses.push({
      title: l.title.slice(0, 120),
      evidence: l.evidence.slice(0, 300),
      fact_ids: factIds,
      automation: { name: automation.name, benefit: automation.benefit },
      monthly_min: min,
      monthly_max: max,
    });
  }
  if (losses.length === 0) return null;

  const total_min = losses.reduce((s, l) => s + l.monthly_min, 0);
  const total_max = losses.reduce((s, l) => s + l.monthly_max, 0);

  const assumptions = (out.assumptions ?? [])
    .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    .slice(0, 8);

  const hook = out.wa_hook?.trim() || losses[0].evidence;

  return {
    scores,
    overall,
    losses,
    total_min,
    total_max,
    assumptions,
    wa_message: buildWaMessage(c, hook, reportUrl),
  };
}
