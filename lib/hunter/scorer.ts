import type { HunterPriority, RawLead, ScoredLead } from "@/types/hunter";

// ============================================================
// Hunter score (0-100). The thesis: a busy, well-reviewed local
// business with NO website is the fastest AYROMEX close.
// ============================================================

const HOT_CATEGORIES = [
  "parrucchiere",
  "barbiere",
  "estetista",
  "tattoo",
  "palestra",
  "ristorante",
  "bar",
  "pizzeria",
  "trattoria",
];

const WARM_CATEGORIES = [
  "dentista",
  "avvocato",
  "commercialista",
  "architetto",
  "consulente",
  "fisioterapista",
];

const TOP_CITIES = [
  "milano",
  "roma",
  "torino",
  "napoli",
  "firenze",
  "bologna",
  "verona",
  "padova",
  "bari",
  "catania",
  "genova",
  "palermo",
];

export function scoreLead(lead: RawLead): ScoredLead {
  let score = 0;

  // No website is the primary signal.
  if (!lead.has_website) score += 45;
  else score -= 20;

  // Rating — quality of the business.
  if (lead.rating >= 4.8) score += 25;
  else if (lead.rating >= 4.5) score += 20;
  else if (lead.rating >= 4.0) score += 10;
  else if (lead.rating < 3.5) score -= 15;

  // Reviews — a living, active business.
  if (lead.reviews >= 100) score += 20;
  else if (lead.reviews >= 50) score += 15;
  else if (lead.reviews >= 20) score += 10;
  else if (lead.reviews < 5) score -= 10;

  // Reachable by phone.
  if (lead.phone && lead.phone.length > 5) score += 15;

  // Category fit.
  const category = lead.category?.toLowerCase() ?? "";
  if (HOT_CATEGORIES.some((c) => category.includes(c))) score += 15;
  else if (WARM_CATEGORIES.some((c) => category.includes(c))) score += 10;

  // High-density city.
  const address = lead.address?.toLowerCase() ?? "";
  if (TOP_CITIES.some((c) => address.includes(c))) score += 5;

  score = Math.max(0, Math.min(100, score));

  const priority: HunterPriority =
    score >= 80 ? "HOT" : score >= 60 ? "WARM" : "COLD";

  return {
    ...lead,
    hunter_score: score,
    priority,
  };
}
