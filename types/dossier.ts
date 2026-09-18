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
  | "linked_page"     // pagina collegata a mano al lead
  | "grounded_search";// citato da una ricerca Google: e un INDIZIO, non una prova

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
  | "cross_reference"
  | "search_citation";

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
  | "confirmed"             // due o piu segnali forti: e suo
  | "likely"                // un segnale forte: probabile, non provato
  | "unverified_candidate"  // trovato ma non verificato: resta nel dossier
  | "rejected"              // segnali contrari
  | "browser_required";     // non si e potuto guardare: NON e «non esiste»

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
/** Si puo MOSTRARE, e a quali condizioni. Indipendente dal possesso:
 *  una foto di Google Places non e nostra e non si puo copiare, ma si
 *  puo mostrare tramite il provider con la sua attribuzione. Confondere
 *  le due cose fa scartare materiale perfettamente utilizzabile. */
export type DisplayStatus =
  | "display_allowed"                  // nostra o autorizzata: si mostra e basta
  | "display_allowed_with_attribution" // si mostra citando la fonte
  | "display_after_approval"           // solo demo privata finche non e approvata
  | "display_forbidden";

/** Si puo CONSERVARE una copia? */
export type StorageStatus =
  | "store_allowed"
  | "do_not_store";   // si rende on demand tramite il provider, mai copiata

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
  display_status: DisplayStatus;
  storage_status: StorageStatus;
  allowed_scope: UsageScope;
  /** Scadenza imposta dal provider, quando c'e. */
  expires_at: string;
  /** Riferimento opaco del provider, per il rendering differito. */
  provider_reference: string;
  /** Perche e stato scartato, quando lo e stato. */
  rejected_reason: string;
}

/** I quattro numeri che servono davvero nel pannello. «0 approvate»
 *  da solo faceva credere che non ci fosse niente da mostrare, mentre
 *  c'erano dieci fotografie perfettamente visualizzabili. */
export interface ContiMedia {
  totali: number;
  tramite_provider: number;
  proprietarie: number;
  copiabili: number;
  utilizzabili_in_demo: number;
  da_approvare: number;
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
  /** Conteggi per cio che si puo FARE, che e la domanda vera. */
  counts: ContiMedia;
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

/**
 * TRE decisioni, non una.
 *
 * Una decisione sola costringeva a mescolare domande che non hanno
 * niente a che vedere fra loro, e produceva il difetto che si e visto
 * sul primo lead reale: un'attivita identificata con sicurezza,
 * operativa, con sedici fatti verificati e zero conflitti finiva in
 * REVIEW perche non aveva un sito. Ma l'assenza del sito e il MOTIVO
 * per cui la Factory esiste, non un dubbio sull'attivita.
 *
 * Quindi: «vale la pena lavorarci» e una domanda commerciale, «ho
 * abbastanza materiale» e una domanda di contenuto, «posso mostrare
 * delle fotografie» e una domanda di diritti. Rispondono in modo
 * indipendente.
 */
export type CommercialRecommendation = "GO" | "REVIEW" | "REJECT";

/** Quanto materiale c'e per costruire una demo. */
export type ContentReadiness = "READY" | "PARTIAL" | "BLOCKED";

/** Che cosa si puo far vedere, e a quali condizioni. */
export type MediaReadiness = "DISPLAYABLE" | "APPROVAL_REQUIRED" | "NONE" | "BLOCKED";

/** Alias storico: il vecchio campo unico valeva quello commerciale. */
export type DossierRecommendation = CommercialRecommendation;

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

  /** Vale la pena proporre un sito a questa attivita? */
  commercial_recommendation: CommercialRecommendation;
  /** C'e abbastanza materiale per costruire la demo? */
  content_readiness: ContentReadiness;
  /** Che cosa si puo mostrare, e a quali condizioni? */
  media_readiness: MediaReadiness;
  /** Le ragioni, per decisione. */
  decision_reasons: {
    commercial: string[];
    content: string[];
    media: string[];
  };

  /** Punteggio del sito esistente, quando un sito c'e. Serve alla
   *  decisione commerciale: un sito gia buono e l'unico motivo per cui
   *  un'attivita sana non e un'opportunita. */
  website_opportunity_score: number | null;

  /** @deprecated Campo unico storico. Vale `commercial_recommendation`:
   *  resta per i dossier salvati prima della separazione. */
  recommendation: DossierRecommendation;
  /** @deprecated Vale `decision_reasons.commercial`. */
  recommendation_reasons: string[];

  /** Quanto e costato: chiamate esterne e tempo. */
  cost: { external_calls: number; total_ms: number };

  /** Costo ed esito della scoperta social con ricerca. Sta nel dossier e
   *  non solo nei log perche e cio che si guarda per sapere se la
   *  ricerca sta producendo qualcosa o solo consumando interrogazioni. */
  search?: {
    status: string;
    queries: number;
    tokens: number;
    /** Dove si e fermata la scoperta. Senza questi, `no_results` mette
     *  insieme «non ha citato niente», «le citazioni non erano profili» e
     *  «i reindirizzamenti non si sono risolti»: tre guasti con tre
     *  rimedi diversi, appiattiti su una parola sola. */
    citations?: number;
    resolved?: number;
    profiles?: number;
  };
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
  /** true = sessioni firmate con un segreto derivato dalla password
   *  perche `NEXTAUTH_SECRET` manca. Chiuso, ma da sistemare. */
  authentication_derived_secret: boolean;
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
