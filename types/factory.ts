// ============================================================
// AYRO SPECTRE — Autonomous Website Factory + Agentic CRM
// Tipi condivisi. Regola portante: ogni informazione COMMERCIALE
// viaggia dentro un Fact<T> con fonte, metodo, timestamp e banda di
// affidabilità. Il testo creativo è separato e non può contenere
// affermazioni fattuali (prezzi, team, certificazioni…).
// ============================================================

/** Quanto ci si può fidare di un dato. */
export type FactBand = "verified" | "probable" | "possible";

/** Ciclo di vita di un fatto proposto dall'automazione. */
export type FactStatus = "applied" | "proposed" | "dismissed" | "superseded";

/** Un dato con provenienza. Senza `source` il dato NON è pubblicabile. */
export interface Fact<T = string> {
  value: T;
  /** URL o identificatore della fonte (es. "google_places", "https://…"). */
  source: string;
  /** Come è stato ottenuto (es. "places_details", "site_html", "manual"). */
  method: string;
  /** ISO timestamp dell'osservazione. */
  observed_at: string;
  band: FactBand;
}

// ----- Analisi del sito esistente ---------------------------------

export type WebsiteStatus =
  | "no_website"
  | "offline"
  | "blocked"
  | "insecure"
  | "not_mobile"
  | "slow"
  | "outdated"
  | "no_cta"
  | "no_contacts"
  | "acceptable"
  | "unknown";

/** Motivazione esplicita e misurabile di un punto di score. */
export interface OpportunityReason {
  code: string;
  label: string;
  /** Punti aggiunti al punteggio opportunità (positivo = più opportunità). */
  points: number;
  /** Valore misurato che ha prodotto il punto (per audit). */
  measured?: string;
}

export interface WebsiteAnalysis {
  url: string;
  status: WebsiteStatus;
  /** 0-100: quanto vale la pena proporre un sito nuovo. */
  opportunity_score: number;
  reasons: OpportunityReason[];
  http_status: number | null;
  /** Millisecondi del primo byte/risposta. */
  response_ms: number | null;
  https: boolean;
  has_viewport: boolean;
  has_cta: boolean;
  has_contacts: boolean;
  html_bytes: number;
  checked_at: string;
  error: string;
}

// ----- SiteSpec ---------------------------------------------------

export type SectionKind =
  | "hero"
  | "services"
  | "about"
  | "reviews"
  | "contact"
  | "hours"
  | "map";

export interface SiteSection {
  kind: SectionKind;
  /** Titolo di sezione: copy neutro, nessuna affermazione fattuale. */
  title: string;
  /** Corpo opzionale: copy neutro. */
  body?: string;
}

export interface SiteImage {
  /** URL dell'immagine autorizzata, oppure "" per placeholder. */
  url: string;
  alt: string;
  /** true = segnaposto generato dal renderer (nessun asset di terzi). */
  placeholder: boolean;
  source: string;
}

export type CtaKind = "call" | "whatsapp" | "maps" | "email";

export interface SiteCta {
  label: string;
  kind: CtaKind;
  /** Telefono/URL. Deve derivare da un Fact verificato. */
  target: string;
}

export interface SitePalette {
  primary: string;
  accent: string;
  bg: string;
  fg: string;
}

/** Testo creativo NEUTRO. Non può contenere dati fattuali non verificati. */
export interface SiteCopy {
  hero_title: string;
  hero_subtitle: string;
  about: string;
}

export interface SiteSpec {
  spec_version: number;
  lead_id: string;
  business: {
    name: Fact<string>;
    category: Fact<string>;
    address?: Fact<string>;
    phone?: Fact<string>;
    email?: Fact<string>;
    maps_url?: Fact<string>;
    hours?: Fact<string[]>;
  };
  reviews?: {
    rating: Fact<number>;
    count: Fact<number>;
  };
  /** Servizi REALI: ognuno con la sua fonte. Mai inventati. */
  services: Fact<string>[];
  sections: SiteSection[];
  cta: SiteCta;
  palette: SitePalette;
  images: SiteImage[];
  seo: { title: string; description: string };
  copy: SiteCopy;
  /** Campi che mancano: il renderer usa copy neutro e li segnala. */
  incomplete: string[];
  /** Tutte le fonti usate, per il pannello "provenienza". */
  sources: string[];
  generated_at: string;
}

/** Esito di una validazione (contratto stile Zod, senza dipendenze). */
export interface ValidationResult<T> {
  ok: boolean;
  value: T | null;
  errors: string[];
}

// ----- Forge project ----------------------------------------------

export type FactoryStage =
  | "discovered"
  | "research_pending"
  | "researching"
  | "eligible"
  | "rejected"
  | "generation_pending"
  | "generating"
  | "qa_pending"
  | "qa_failed"
  | "ready"
  | "outreach_ready"
  | "sent"
  | "viewed"
  | "replied"
  | "appointment"
  | "negotiating"
  | "won"
  | "lost"
  | "client_approved";

export interface ForgeProject {
  id: string;
  lead_id: string;
  slug: string;
  stage: FactoryStage;
  spec_version: number;
  spec: SiteSpec | null;
  template: string;
  demo_url: string;
  qa_score: number;
  qa_report: QaReport | null;
  screenshot_desktop: string;
  screenshot_mobile: string;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

// ----- QA ----------------------------------------------------------

export interface QaCheck {
  code: string;
  label: string;
  passed: boolean;
  /** true = il fallimento blocca la pubblicazione. */
  blocking: boolean;
  detail: string;
}

export interface QaReport {
  passed: boolean;
  score: number;
  checks: QaCheck[];
  checked_at: string;
  screenshots: { desktop: string; mobile: string };
}

// ----- Coda agentica ------------------------------------------------

export type JobKind =
  | "analyze_website"
  | "research_business"
  | "collect_business_intelligence"
  | "generate_site"
  | "run_site_qa"
  | "prepare_outreach"
  | "schedule_followup";

export type JobStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface AgentJob {
  id: string;
  lead_id: string;
  deal_id: string;
  forge_project_id: string;
  kind: JobKind;
  reason: string;
  payload: Record<string, unknown>;
  priority: number;
  /** Budget massimo di chiamate esterne consentite al job. */
  budget: number;
  attempts: number;
  max_attempts: number;
  status: JobStatus;
  due_at: string;
  leased_until: string | null;
  worker_id: string;
  started_at: string | null;
  finished_at: string | null;
  outcome: string;
  error: string;
  /** Chiave di idempotenza: un solo job vivo per (lead, kind). */
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ----- CRM agentico -------------------------------------------------

export type ActivityType =
  | "note"
  | "call"
  | "visit"
  | "email"
  | "whatsapp"
  | "meeting"
  | "task"
  | "stage_change"
  | "research"
  | "demo_generated"
  | "qa"
  | "ai_action"
  | "demo_viewed";

export interface Activity {
  id: string;
  lead_id: string;
  forge_project_id: string;
  type: ActivityType;
  subject: string;
  body: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
  due_at: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContactFact {
  id: string;
  lead_id: string;
  field: string;
  value: string;
  band: FactBand;
  status: FactStatus;
  evidence: Record<string, unknown>;
  source_url: string;
  method: string;
  observed_at: string;
  decided_at: string | null;
  created_at: string;
}

export interface Followup {
  id: string;
  lead_id: string;
  forge_project_id: string;
  title: string;
  note: string;
  due_at: string;
  completed_at: string | null;
  assigned_to: string;
  /** Chiave anti-duplicato (lead + titolo normalizzato + giorno). */
  dedup_key: string;
  created_at: string;
  updated_at: string;
}

export interface DemoView {
  id: string;
  forge_project_id: string;
  lead_id: string;
  /** Aggregato: "mobile" | "desktop" — nessun fingerprinting. */
  device: string;
  cta_clicked: string;
  viewed_at: string;
}

// ----- Outreach preparato -------------------------------------------

export interface OutreachDraft {
  reason: string;
  audit_summary: string;
  whatsapp: string;
  email_subject: string;
  email_body: string;
  call_opening: string;
  cta: string;
  objections: { objection: string; answer: string }[];
  next_followup_at: string;
}
