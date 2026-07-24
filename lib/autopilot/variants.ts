import type { WaVariant } from "@/types/autopilot";

// ============================================================
// Stadio 1.5 — VARIANTI PRIMO MESSAGGIO WA (A/B test).
// Tre aperture deterministiche (Ramona di AYROMEX). La variante è
// scelta da hash(lead_id) % 3: stessa scelta a ogni ricomposizione,
// distribuzione bilanciata per misurare il tasso di risposta.
// Il complimento esce SEMPRE dai dati del singolo lead (rating/recensioni
// Google), mai hardcoded: se i numeri non ci sono si scende nel fallback,
// non si inventa ("0 su Google" / "0 recensioni" non vengono mai composti).
// ============================================================

const SIGN = "Ciao, sono Ramona di AYROMEX.";

/** Rotazione deterministica A/B/C. Hash stabile (djb2-like su 32 bit) del
 *  lead_id, modulo 3: lo stesso lead ricade sempre nella stessa variante. */
export function pickVariant(leadId: string): WaVariant {
  let h = 0;
  for (let i = 0; i < leadId.length; i++) {
    h = (h * 31 + leadId.charCodeAt(i)) >>> 0;
  }
  return (["A", "B", "C"] as const)[h % 3];
}

export interface ComplimentInput {
  /** Rating Google (leads.meta.rating). 0 = assente, NON un rating reale. */
  rating: number;
  /** N. recensioni Google (leads.meta.reviews). 0 = assente. */
  reviews: number;
  /** Categoria/settore (autopilot_pipeline.category). "" = sconosciuta. */
  category: string;
}

/** Esito della scala di fallback del complimento:
 *  - numeric: c'è un dato Google reale → frase con i numeri del lead
 *  - generic: niente numeri ma categoria nota → complimento generico
 *  - bare:    nessun dato → la frase va riformulata senza complimento  */
type ComplimentTier =
  | { kind: "numeric"; phrase: string }
  | { kind: "generic" }
  | { kind: "bare" };

/** "5.0", "4.8" — punto decimale come negli esempi del brief. */
const fmtRating = (r: number): string => r.toFixed(1);
const fmtReviews = (n: number): string => String(Math.round(n));
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Scala di fallback (Step 3). Il check è sul VALORE (> 0), non sulla
 *  presenza del campo: l'assente qui è 0. Mai comporre "0 su Google". */
export function complimentTier({
  rating,
  reviews,
  category,
}: ComplimentInput): ComplimentTier {
  const hasRating = rating > 0;
  const hasReviews = reviews > 0;

  // rating forte (>=4.5) + recensioni → dato pieno
  if (hasRating && rating >= 4.5 && hasReviews) {
    return {
      kind: "numeric",
      phrase: `${fmtRating(rating)} su Google con ${fmtReviews(reviews)} recensioni`,
    };
  }
  // solo rating (recensioni assenti)
  if (hasRating && !hasReviews) {
    return { kind: "numeric", phrase: `un bel ${fmtRating(rating)} su Google` };
  }
  // recensioni presenti con rating assente o sotto 4.5 → punta sulle recensioni
  if (hasReviews) {
    return { kind: "numeric", phrase: `oltre ${fmtReviews(reviews)} recensioni su Google` };
  }
  // niente numeri: complimento generico solo se almeno la categoria c'è
  if (category && category.trim()) return { kind: "generic" };
  return { kind: "bare" };
}

// ----- Le tre varianti ---------------------------------------
// Ogni variante ha tre forme: numerica (con il dato vero), generica
// (categoria nota, nessun numero) e bare (nessun dato, frase naturale
// senza la parte di complimento).

function variantA(t: ComplimentTier): string {
  const tail =
    "Visto che su Maps andate forte, posso chiedervi come mai non avete ancora un sito vostro? Pura curiosità.";
  if (t.kind === "numeric")
    return `${SIGN} Ho visto che avete ${t.phrase}, complimenti davvero! ${tail}`;
  if (t.kind === "generic")
    return `${SIGN} Ho visto che siete tra i più apprezzati della zona, complimenti davvero! ${tail}`;
  return `${SIGN} Ho dato un'occhiata alla vostra attività su Maps e mi ha colpita. Posso chiedervi come mai non avete ancora un sito vostro? Pura curiosità.`;
}

function variantB(t: ComplimentTier): string {
  // "ma solo i social" rimosso: la coda regge anche sui lead Scout senza
  // Instagram noto. "con dei numeri così" solo quando i numeri ci sono.
  const tailNum =
    "Una cosa mi ha incuriosita: con dei numeri così, come mai chi vi cerca online non trova un sito vostro? Ve lo chiedo per capire.";
  const tailPlain =
    "Una cosa mi ha incuriosita: come mai chi vi cerca online non trova un sito vostro? Ve lo chiedo per capire.";
  if (t.kind === "numeric")
    return `${SIGN} Ho visto la vostra scheda Google, ${t.phrase}, complimenti! ${tailNum}`;
  if (t.kind === "generic")
    return `${SIGN} Ho visto la vostra scheda Google e siete tra i più apprezzati della zona, complimenti! ${tailPlain}`;
  return `${SIGN} Ho visto la vostra scheda Google, complimenti per quello che fate! ${tailPlain}`;
}

function variantC(t: ComplimentTier): string {
  const tail =
    "Mi tolgo una curiosità: il sito è una cosa che avete messo da parte di proposito o semplicemente non è mai saltato fuori il momento?";
  if (t.kind === "numeric")
    return `${SIGN} ${cap(t.phrase)}, vuol dire che i clienti vi adorano davvero, complimenti! ${tail}`;
  if (t.kind === "generic")
    return `${SIGN} Essere tra i più apprezzati della zona vuol dire che i clienti vi adorano davvero, complimenti! ${tail}`;
  return `${SIGN} Si vede che lavorate bene, complimenti! ${tail}`;
}

export interface FirstMessageLead {
  lead_id: string;
  rating: number;
  reviews: number;
  category: string;
}

/** Compone il primo messaggio WA del lead: sceglie la variante in modo
 *  deterministico e riempie il complimento con i dati reali (o fallback).
 *  Ritorna anche quale variante è stata usata, da salvare sul record. */
export function composeFirstMessage(lead: FirstMessageLead): {
  variant: WaVariant;
  message: string;
} {
  const variant = pickVariant(lead.lead_id);
  const tier = complimentTier(lead);
  const build =
    variant === "A" ? variantA : variant === "B" ? variantB : variantC;
  return { variant, message: build(tier) };
}
