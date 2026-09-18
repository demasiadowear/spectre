import type { RightsStatus } from "@/types/dossier";

// ============================================================
// Due regimi, non un manifest solo trattato allo stesso modo.
//
// Le fotografie di Google Places e quelle fornite dal cliente hanno la
// stessa forma nel MediaManifest e regole opposte su cosa si puo
// CONSERVARE di cio che un modello ci legge dentro.
//
// Places: Google Maps Platform ToS §3.2.3(c) vieta di «create content
// based on Google Maps Content», e porta come esempio «construct an
// index of tree locations within a city from Street View imagery».
// Costruire un indice di soggetti e marchi rilevati a partire dalle
// fotografie di un Place e la stessa operazione con un altro sostantivo.
// Quindi l'analisi puo avvenire, ma il suo risultato semantico non
// sopravvive alla richiesta.
//
// Cliente: non e Google Maps Content. Li si conserva tutto.
//
// NOTA: la modalita effimera su Places NON e dichiarata conforme. E
// una nostra lettura, in attesa di risposta scritta — vedi
// docs/GOOGLE-MAPS-PHOTO-CLARIFICATION.md.
// ============================================================

export type RegimeMedia = "provider_rendered" | "customer_owned";

export function regimeDi(r: RightsStatus): RegimeMedia {
  return r === "customer_owned" ? "customer_owned" : "provider_rendered";
}

/**
 * Si puo conservare cio che il modello ha LETTO nell'immagine?
 *
 * Solo per il materiale del cliente. Per tutto il resto la risposta e
 * no, e non e una precauzione: e la differenza fra una decisione di
 * impaginazione e un indice di contenuti derivato da immagini altrui.
 */
export function puoPersistereSemantica(r: RightsStatus): boolean {
  return regimeDi(r) === "customer_owned";
}

/** I campi semantici che per `provider_rendered` non escono mai dalla
 *  funzione di analisi. Elencati perche un test possa verificarli sul
 *  risultato vero, invece di fidarsi della revisione del codice. */
export const CAMPI_SEMANTICI = [
  "observed_subjects", "environment_type", "text_detected",
  "brand_marks_detected", "candidate_colors", "palette",
  "clutter_score", "sharpness_score", "lighting_score",
  "commercial_appeal_score", "cleanliness_perception",
  "reasons", "description", "descrizione", "ocr", "embedding",
  "visual_hash", "perceptual_hash_semantico",
] as const;

/**
 * Toglie da un oggetto qualunque campo semantico, a qualunque
 * profondita.
 *
 * Esiste come rete, non come meccanismo principale: il meccanismo e
 * che per Places il tipo restituito non CONTIENE quei campi. Ma fra il
 * tipo e il disco c'e `JSON.stringify`, che i tipi non li vede — e
 * basta un `...spread` di troppo perche un campo rientri.
 */
export function senzaSemantica<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => senzaSemantica(x)) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if ((CAMPI_SEMANTICI as readonly string[]).indexOf(k) !== -1) continue;
      out[k] = senzaSemantica(val);
    }
    return out as T;
  }
  return v;
}
