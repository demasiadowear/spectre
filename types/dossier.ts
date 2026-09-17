// ============================================================
// AYRO SPECTRE — BusinessDossier e MediaManifest.
//
// Il dossier e la FONTE CANONICA UNICA su un'attivita. Detective,
// Factory e generatore leggono da qui: nessuno rifa il fetch, nessuno
// tiene un modello concorrente.
//
// Riusa `Fact`, `FactBand` e `FactStatus` da ./factory invece di
// ridefinirli. Quello che aggiunge e cio che al Fact mancava per fare
// questo mestiere: il TIPO di fonte separato dall'URL, una confidenza
// numerica accanto alla banda, il gruppo di conflitto, e l'ambito d'uso.
//
// Regola che tiene in piedi tutto: un conflitto non si risolve in
// silenzio. Telefono, indirizzo e orari discordanti mandano il dossier
// in REVIEW, non nella colonna "risolto".
// ============================================================

import type { Fact, FactBand, FactStatus } from "./factory";

// ----- Fonti ------------------------------------------------------

/** Da CHE COSA arriva un dato, indipendentemente dall'URL preciso. */
export type SourceType =
  | "manual"          // inserito a mano da un operatore
  | "lead"            // gia sul lead prima della raccolta
  | "google_places"   // API Places
  | "official_site"   // sito riconosciuto come ufficiale
  | "site_structured" // JSON-LD / microdati dentro quel sito
  | "site_meta"       // Open Graph / meta tag
  | "site_text"       // pattern nel testo visibile
  | "social_profile"  // profilo verificato come ufficiale
  | "linked_page";    // pagina collegata a mano al lead

/** Come e stato ottenuto. Piu fine di `SourceType`: serve all'audit. */
export type ExtractionMethod =
  | "places_search"
  | "places_details"
  | "json_ld"
  | "microdata"
  | "meta_tag"
  | "link_href"
  | "text_pattern"
  | "manual_entry"
  | "cross_reference";

/** Dove puo finire un dato. Un dato raccolto non e un dato pubblicabile. */
export type UsageScope =
  | "public"           // si puo mettere su un sito pubblico
  | "preview_only"     // solo nella demo privata noindex
  | "internal_review"  // solo nel pannello, mai in pagina
  | "blocked";         // non si usa

/** Un fatto del dossier: `Fact` con quello che serve a decidere. */
export interface DossierFact<T = string> extends Fact<T> {
  /** Campo del dossier a cui si riferisce (phone, address, hours…). */
  field: string;
  /** Tipo di fonte, separato dall'URL. */
  source_type: SourceType;
  /** URL preciso da cui viene, quando esiste. */
  source_url: string;
  extraction_method: ExtractionMethod;
  /** 0–100. La banda resta la sintesi leggibile di questa soglia. */
  confidence: number;
  /** Frammento che lo prova. Senza, il fatto non e verificabile. */
  evidence: string;
  /** Se piu valori competono per lo stesso campo, condividono la chiave. */
  conflict_group: string;
  usage_scope: UsageScope;
  status: FactStatus;
}

/** Valori discordanti per lo stesso campo. Non si sceglie in silenzio. */
export interface DossierConflict {
  field: string;
  conflict_group: string;
  /** Il valore della fonte piu alta: proposto, non deciso. */
  kept: { value: string; source_type: SourceType; confidence: number };
  /** Gli altri: scartati ma non dimenticati. */
  others: { value: string; source_type: SourceType; confidence: number }[];
  /** true = da solo basta a mandare il dossier in REVIEW. */
  blocking: boolean;
}

// ----- Identita ---------------------------------------------------

export type Platform =
  | "website" | "google_maps" | "instagram" | "facebook"
  | "tiktok" | "youtube" | "linkedin" | "altro";

/** Esito della verifica di appartenenza di un profilo all'attivita. */
export type IdentityStatus =
  | "verified"        // due o piu segnali forti
  | "probable"        // un segnale forte, o piu deboli concordi
  | "ambiguous"       // indizi contrastanti: decide una persona
  | "rejected"        // segnali contrari
  | "browser_required"; // serve un browser vero per stabilirlo

/** Segnali forti: due di questi bastano per `verified`. Un nome simile
 *  e la stessa citta NON sono in questo elenco, ed e il punto. */
export type IdentitySignal =
  | "same_domain"          // il profilo linka il dominio ufficiale
  | "same_phone"
  | "same_address"
  | "reciprocal_link"      // sito e profilo si linkano a vicenda
  | "same_place_id"        // stesso place_id o URL Maps
  | "declared_username"    // il sito ufficiale dichiara quell'username
  // --- deboli, da qui in giu: da soli non bastano mai ---
  | "similar_name"
  | "same_city"
  | "same_category";

export const SEGNALI_FORTI: readonly IdentitySignal[] = [
  "same_domain", "same_phone", "same_address",
  "reciprocal_link", "same_place_id", "declared_username",
] as const;

export interface IdentityCandidate {
  candidate_url: string;
  platform: Platform;
  /** 0–100. */
  confidence: number;
  positive_signals: IdentitySignal[];
  /** Cio che gioca CONTRO: un telefono diverso, un'altra citta. */
  negative_signals: string[];
  status: IdentityStatus;
  /** Perche e finito in questo stato, in una riga leggibile. */
  rationale: string;
  /** Da dove e saltato fuori questo candidato. */
  discovered_via: SourceType;
}

// ----- Media ------------------------------------------------------

/** Che diritto abbiamo su un file. «E pubblica» non e in questo elenco:
 *  pubblicazione e diritto di riutilizzo non sono la stessa cosa. */
export type RightsStatus =
  | "customer_owned"                    // fornito o autorizzato dal cliente
  | "official_public_pending_approval"  // sui canali ufficiali, in attesa
  | "provider_rendered"                 // si mostra tramite il provider
  | "unknown"                           // non si usa
  | "forbidden";                        // si elimina

/** A che cosa serve l'immagine nel sito. Stimato, non dichiarato. */
export type MediaRole =
  | "hero" | "venue" | "work" | "product" | "food"
  | "team" | "owner" | "logo" | "exterior" | "equipment" | "unknown";

export interface MediaCandidate {
  id: string;
  /** URL diretto del file, quando il provider ne consente la lettura. */
  source_url: string;
  /** Pagina o profilo da cui e stato raggiunto. */
  source_page: string;
  platform: Platform;
  /** Chi si presume ne sia titolare, quando desumibile. */
  copyright_owner: string;
  /** Testo di attribuzione che il provider impone di mostrare. */
  attribution: string;
  observed_at: string;

  /** Presente solo se i byte sono stati davvero letti. */
  sha256: string;
  /** Hash percettivo: intercetta la stessa foto ricompressa o riscalata. */
  perceptual_hash: string;
  width: number;
  height: number;
  format: string;
  filesize: number;
  orientation: "landscape" | "portrait" | "square" | "unknown";

  probable_role: MediaRole;
  /** 0–100: nitidezza, dimensione, rapporto. Non e gusto, e misura. */
  quality_score: number;
  /** 0–100: quanto c'entra con questa attivita. */
  relevance_score: number;
  /** Stessa chiave = stesso soggetto, anche con URL diversi. */
  duplicate_group: string;
  /** true = ci sono persone riconoscibili. Alza l'asticella sui diritti. */
  people_present: boolean;

  rights_status: RightsStatus;
  allowed_scope: UsageScope;
  /** Scadenza imposta dal provider, quando c'e. */
  expires_at: string;
  /** Riferimento opaco del provider, per il rendering differito. */
  provider_reference: string;
  /** Perche e stato scartato, quando lo e stato. */
  rejected_reason: string;
}

export interface MediaManifest {
  lead_id: string;
  generated_at: string;
  candidates: MediaCandidate[];
  /** Approvati da una persona: gli unici che possono uscire in pubblico. */
  approved_ids: string[];
  rejected: { source_url: string; reason: string }[];
  /** Conteggi per stato dei diritti, per il pannello. */
  by_rights: Record<RightsStatus, number>;
}

// ----- Dossier ----------------------------------------------------

/** Cosa si e potuto fare per davvero, fonte per fonte. */
export interface SourceAttempt {
  source_type: SourceType;
  url: string;
  ok: boolean;
  /** `browser_required` quando serve un browser vero per andare avanti. */
  outcome: "ok" | "not_found" | "blocked" | "browser_required" | "error" | "skipped";
  detail: string;
  /** Millisecondi spesi. Serve a sapere quanto costa il job. */
  ms: number;
}

export type DossierRecommendation = "GO" | "REVIEW" | "REJECT";

export interface BusinessDossier {
  dossier_version: number;
  lead_id: string;
  generated_at: string;

  /** Identita Places: e l'ancora a cui tutto il resto si aggancia. */
  place_id: string;
  /** Sito riconosciuto come ufficiale (host normalizzato incluso). */
  official_site: string;
  official_host: string;

  /** Fatti tenuti, con provenienza completa. */
  verified: DossierFact[];
  /** Fatti plausibili ma non provati: mai pubblicabili come veri. */
  probable: DossierFact[];
  conflicts: DossierConflict[];
  /** Campi cercati e non trovati. Distinti dai campi mai cercati. */
  missing: string[];

  /** Profili valutati, accettati e rifiutati, con il perche. */
  identities: IdentityCandidate[];
  media: MediaManifest;

  sources: SourceAttempt[];
  recommendation: DossierRecommendation;
  /** Le ragioni della raccomandazione, in chiaro. */
  recommendation_reasons: string[];

  /** Quanto e costato: chiamate esterne e tempo. */
  cost: { external_calls: number; total_ms: number };
}

// ----- Fasi del job ----------------------------------------------

export type CollectPhase =
  | "places"
  | "official_site"
  | "social_discovery"
  | "media"
  | "reconcile";

export const FASI: readonly CollectPhase[] = [
  "places", "official_site", "social_discovery", "media", "reconcile",
] as const;

export interface PhaseState {
  phase: CollectPhase;
  status: "pending" | "running" | "ok" | "failed" | "skipped";
  detail: string;
  ms: number;
}

/** Stato osservabile del job, quello che la dashboard mostra. */
export interface CollectProgress {
  lead_id: string;
  job_id: string;
  phases: PhaseState[];
  current: CollectPhase | null;
  finished_at: string;
  error: string;
}

/** Capacita del runtime. SOLO booleani: mai valori, prefissi o lunghezze.
 *  `database_configured` dice che le variabili ci sono; `_reachable` che
 *  l'host risponde; `_schema_present` che le tabelle esistono. Sono tre
 *  guasti diversi che si sistemano in tre modi diversi, e unirli in un
 *  solo booleano costringe a indovinare quale dei tre sia. */
export interface CapabilityReport {
  authentication_configured: boolean;
  database_configured: boolean;
  database_reachable: boolean;
  database_schema_present: boolean;
  google_places_configured: boolean;
  storage_configured: boolean;
  browser_worker_configured: boolean;
  /** Nomi delle variabili che mancano, e in quale scope. Nomi, non valori. */
  missing: { name: string; scope: string }[];
}

export type { Fact, FactBand, FactStatus };
