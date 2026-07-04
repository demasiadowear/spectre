import type { RawIntentRequest } from "@/types/intent";
import {
  INTENT_KEYWORDS,
  INTENT_PUGLIA_ZONES,
  INTENT_SCORE_BASE,
  INTENT_SCORE_BUDGET_BONUS,
  INTENT_SCORE_FRESH_24H,
  INTENT_SCORE_FRESH_48H,
  INTENT_SCORE_FRESH_7D,
  INTENT_SCORE_PUGLIA_BONUS,
} from "./constants";

// ============================================================
// Filtro keyword + scoring 0-100 dei lead intent.
// ============================================================

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex word-boundary per ogni keyword ("seo" non matcha "museo"). */
const KEYWORD_PATTERNS = INTENT_KEYWORDS.map(
  (k) => new RegExp(`(^|[^a-zà-ù])${escapeRegex(k)}([^a-zà-ù]|$)`, "i"),
);

/** True se titolo+testo+categoria parlano di sito web / servizi
 *  digitali. La categoria piattaforma (es. "Sviluppo Siti Web") è
 *  segnale strutturato: entra nel match anche se il testo non cita
 *  letteralmente le keyword. */
export function matchesIntent(req: RawIntentRequest): boolean {
  const haystack = `${req.title} ${req.body} ${req.category}`.toLowerCase();
  return KEYWORD_PATTERNS.some((p) => p.test(haystack));
}

/** True se zona o testo citano la Puglia. */
export function isPugliaZone(req: RawIntentRequest): boolean {
  const haystack = `${req.zone} ${req.title} ${req.body}`.toLowerCase();
  return INTENT_PUGLIA_ZONES.some((z) =>
    new RegExp(`(^|[^a-zà-ù])${z}([^a-zà-ù]|$)`, "i").test(haystack),
  );
}

/** Ore trascorse dalla pubblicazione; null se la data non è nota.
 *  Le piattaforme con sola data (senza ora) danno mezzanotte: una
 *  richiesta di oggi risulta correttamente <24h. */
export function hoursSincePublished(
  req: RawIntentRequest,
  now = new Date(),
): number | null {
  if (!req.published_at) return null;
  const t = Date.parse(req.published_at);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now.getTime() - t) / 3_600_000);
}

/** Score 0-100: freschezza (<24h = max) + zona Puglia + budget dichiarato. */
export function scoreIntent(req: RawIntentRequest, now = new Date()): number {
  let score = INTENT_SCORE_BASE;

  const hours = hoursSincePublished(req, now);
  if (hours !== null) {
    if (hours < 24) score += INTENT_SCORE_FRESH_24H;
    else if (hours < 48) score += INTENT_SCORE_FRESH_48H;
    else if (hours < 24 * 7) score += INTENT_SCORE_FRESH_7D;
  }

  if (isPugliaZone(req)) score += INTENT_SCORE_PUGLIA_BONUS;
  if (req.budget.trim() !== "") score += INTENT_SCORE_BUDGET_BONUS;

  return Math.min(100, score);
}
