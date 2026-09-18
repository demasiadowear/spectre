import { getPipelineLead } from "@/lib/autopilot/db";
import { raccogli } from "@/lib/collector/collect";
import { leggiDossier, salvaDossier } from "@/lib/collector/db";
import { getLeadById } from "@/lib/data";
import { turso } from "@/lib/turso";
import {
  ensureFactorySchema,
  getOrCreateProject,
  getProject,
  logActivity,
  proposeFact,
  saveProjectQa,
  saveProjectSpec,
  saveWebsiteAnalysis,
  scheduleFollowup,
  setFactoryStage,
  setProjectDemoUrl,
  setProjectStage,
} from "./db";
import { factsFromPlaces, generateSiteSpec, type GenerationInput } from "./generate";
import { researchBusiness, verifiedServices, type ResearchResult } from "./research";
import { prepareOutreach } from "./outreach";
import { qaSummary, runQa } from "./qa";
import {
  claimJob,
  claimSpecificJob,
  completeJob,
  enqueueJob,
  failJob,
  jobsRunToday,
  recoverExpiredLeases,
} from "./queue";
import { hasFreshDemo, loadLimits, shouldRecheck } from "./scout-config";
import { analyzeWebsite, isEligible } from "./website";
import type { CollectPhase } from "@/types/dossier";
import { FASI } from "@/types/dossier";
import type { AgentJob, Fact, FactoryStage, JobKind } from "@/types/factory";

// ============================================================
// Orchestrazione Hunter → analisi → ricerca → generazione → QA →
// outreach preparato.
//
// Quattro freni, tutti attivi per default, perché questo codice spende
// soldi veri (Places, Gemini) e tocca lead veri:
//   1. `dry_run`: calcola e racconta, non scrive e non chiama;
//   2. batch massimo per giro;
//   3. limite giornaliero per tipo di job;
//   4. pausa globale via env (FACTORY_PAUSED).
//
// Il passo finale è `outreach_ready`, non `sent`: la Factory prepara,
// non spedisce. Il messaggio esce quando lo manda una persona.
// ============================================================

export const DEFAULT_BATCH = 5;
export const MAX_BATCH = 20;

/**
 * Tetto giornaliero per tipo di job, derivato dai limiti configurabili
 * (lib/factory/scout-config.ts): `maxSiteAudits` governa le analisi e
 * `maxDemosPerDay` le generazioni, che sono la voce che costa di più.
 * Gli altri tipi non escono verso l'esterno e seguono le demo.
 */
export function dailyLimits(env = process.env): Record<JobKind, number> {
  const l = loadLimits(env);
  return {
    analyze_website: l.maxSiteAudits,
    research_business: l.maxSiteAudits,
    // La raccolta esce verso Google e verso il sito del prospect, quindi
    // segue il tetto delle analisi e non quello dei job interni.
    collect_business_intelligence: l.maxSiteAudits,
    generate_site: l.maxDemosPerDay,
    run_site_qa: l.maxDemosPerDay * 2,
    prepare_outreach: l.maxDemosPerDay * 2,
    schedule_followup: 200,
  };
}

/** Compatibilità: i valori predefiniti senza env impostate. */
export const DAILY_LIMITS: Record<JobKind, number> = dailyLimits({} as NodeJS.ProcessEnv);

export function isFactoryPaused(): boolean {
  const v = (process.env.FACTORY_PAUSED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/** Base URL per le preview. Senza questa il demo_url non è costruibile. */
export function publicBaseUrl(): string {
  const explicit = process.env.FACTORY_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export interface WorkerResult {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped_limit: JobKind[];
  paused: boolean;
  recovered_leases: number;
  details: { job_id: string; kind: JobKind; lead_id: string; outcome: string }[];
}

interface LeadContext {
  lead_id: string;
  name: string;
  category: string;
  city: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  maps_url: string;
  rating: number;
  reviews: number;
  /** Campi corretti a mano in SPECTER (meta.manual): precedenza assoluta. */
  manual: Record<string, string>;
  /** Pagine ufficiali già collegate al lead (meta.linked_pages). */
  linked_pages: string[];
  /** Esito dell'analisi precedente: decide se rianalizzare. */
  website_status: string;
  website_checked_at: string | null;
}

const metaStr = (meta: Record<string, unknown>, key: string): string => {
  const v = meta[key];
  return typeof v === "string" ? v : "";
};
const metaNum = (meta: Record<string, unknown>, key: string): number => {
  const v = meta[key];
  return typeof v === "number" ? v : Number(v) || 0;
};
/** Correzioni manuali: solo coppie stringa/stringa, il resto si ignora. */
const metaRecord = (meta: Record<string, unknown>, key: string): Record<string, string> => {
  const v = meta[key];
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const k of Object.keys(v as Record<string, unknown>)) {
    const val = (v as Record<string, unknown>)[k];
    if (typeof val === "string" && val.trim()) out[k] = val.trim();
  }
  return out;
};
const metaList = (meta: Record<string, unknown>, key: string): string[] => {
  const v = meta[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

/** Raccoglie ciò che si sa del lead dalle tabelle esistenti. La
 *  pipeline resta la fonte di verità: qui non si duplica niente. */
async function leadContext(leadId: string): Promise<LeadContext | null> {
  const lead = await getLeadById(leadId);
  if (!lead) return null;
  const meta = (lead.meta ?? {}) as Record<string, unknown>;
  const pipeline = await getPipelineLead(leadId).catch(() => null);
  const prev = await previousAnalysis(leadId);
  const placeId = pipeline?.place_id ?? "";
  return {
    lead_id: leadId,
    name: lead.company || lead.name,
    category: pipeline?.category || metaStr(meta, "category"),
    city: pipeline?.city || metaStr(meta, "city"),
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    address: metaStr(meta, "address"),
    website: metaStr(meta, "website"),
    maps_url: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : "",
    rating: metaNum(meta, "rating"),
    reviews: metaNum(meta, "reviews"),
    manual: metaRecord(meta, "manual"),
    linked_pages: metaList(meta, "linked_pages"),
    website_status: prev.status,
    website_checked_at: prev.checked_at,
  };
}

/** Ultimo esito dell'analisi sito, letto dalla pipeline. Le colonne sono
 *  aggiunte da ensureFactorySchema: su un DB non ancora migrato la query
 *  fallisce e si riparte da zero, che è il comportamento giusto. */
async function previousAnalysis(
  leadId: string,
): Promise<{ status: string; checked_at: string | null }> {
  if (!turso) return { status: "", checked_at: null };
  try {
    const rs = await turso.execute({
      sql: `select website_status, website_checked_at
              from autopilot_pipeline where lead_id = ? limit 1`,
      args: [leadId],
    });
    const row = rs.rows[0] as Record<string, unknown> | undefined;
    if (!row) return { status: "", checked_at: null };
    return {
      status: row.website_status == null ? "" : String(row.website_status),
      checked_at: row.website_checked_at == null ? null : String(row.website_checked_at),
    };
  } catch {
    return { status: "", checked_at: null };
  }
}

/** Errore che non guarisce riprovando: non va ritentato. */
class FatalJobError extends Error {}

// ----- Handler per tipo di job -----------------------------------

async function handleAnalyzeWebsite(job: AgentJob): Promise<string> {
  const ctx = await leadContext(job.lead_id);
  if (!ctx) throw new FatalJobError("lead inesistente");

  const limits = loadLimits();

  // Un esito definitivo non si rianalizza a ogni giro: rifare ogni
  // mattina la stessa richiesta a un sito che è a posto è spesa inutile
  // e, dal lato loro, traffico immotivato.
  if (
    !shouldRecheck({
      checkedAt: ctx.website_checked_at,
      status: ctx.website_status,
      recheckAfterDays: limits.recheckAfterDays,
    })
  ) {
    return `già analizzato (${ctx.website_status}), ricontrollo fra ${limits.recheckAfterDays} giorni`;
  }

  const analysis = await analyzeWebsite(ctx.website);
  await saveWebsiteAnalysis(job.lead_id, analysis);
  await logActivity({
    lead_id: job.lead_id,
    type: "research",
    subject: `Analisi sito: ${analysis.status} (${analysis.opportunity_score}/100)`,
    body: analysis.reasons.map((r) => `· ${r.label}${r.measured ? ` (${r.measured})` : ""}`).join("\n"),
    metadata: { analysis },
    created_by: "ai",
  });

  // La soglia è configurabile: `isEligible` usa quella predefinita,
  // qui si applica quella effettiva dell'installazione.
  const eligible =
    isEligible(analysis) && analysis.opportunity_score >= limits.minOpportunityScore;
  if (!eligible) {
    await setFactoryStage(job.lead_id, "rejected");
    return `scartato: ${analysis.status}, punteggio ${analysis.opportunity_score} sotto la soglia ${limits.minOpportunityScore}`;
  }

  // Eleggibile: si passa alla RICERCA, non direttamente alla
  // generazione. Generare senza avere prima raccolto i dati produrrebbe
  // una demo vuota, che è il modo più rapido di bruciare un lead.
  await setFactoryStage(job.lead_id, "research_pending");
  const project = await getOrCreateProject(job.lead_id, "research_pending");
  await enqueueJob({
    lead_id: job.lead_id,
    kind: "research_business",
    reason: `Opportunità ${analysis.opportunity_score}/100: ${analysis.status}`,
    payload: { analysis },
    forge_project_id: project?.id ?? "",
    priority: analysis.opportunity_score,
    // Budget = pagine scaricabili dal sito del prospect.
    budget: 3,
  });
  return `eleggibile: ${analysis.status}, punteggio ${analysis.opportunity_score}`;
}

/**
 * collect_business_intelligence — la raccolta completa su un lead.
 *
 * Prende SOLO un lead_id. Nessun URL arriva da fuori: quelli che si
 * visitano vengono da Google Places o dall'HTML del sito che Places
 * dichiara, e ognuno passa dalla guardia SSRF. Un endpoint che
 * accettasse un URL dall'operatore sarebbe uno scanner a disposizione
 * di chiunque abbia una sessione.
 *
 * `payload.solo` consente di rilanciare le sole fasi fallite senza
 * rifare da capo quelle riuscite, che e anche il modo di non ripagare
 * le chiamate a Places.
 */
/**
 * Il rifacimento della ricerca social e concesso?
 *
 * Costa fino a quattro interrogazioni a un modello, quindi non deve
 * poter partire da solo. Si onora SOLO se il payload porta la marca
 * dell'operatore, che scrive unicamente la rotta POST dopo aver
 * verificato sessione e origine. Nessun percorso automatico — cron
 * compreso — la scrive.
 *
 * La regola non poggia sul fatto che nessuno accodi mai un job con
 * `force_search`, ma sul fatto che accodarlo NON BASTEREBBE: e la
 * differenza fra una convenzione e una garanzia.
 */
export function ricercaForzataAmmessa(payload: Record<string, unknown>): boolean {
  return payload.force_search === true && payload.origine === "operator";
}

async function handleCollectBusinessIntelligence(job: AgentJob): Promise<string> {
  const ctx = await leadContext(job.lead_id);
  if (!ctx) throw new FatalJobError("lead inesistente");

  const payload = job.payload ?? {};
  const solo = Array.isArray(payload.solo)
    ? (payload.solo as string[]).filter((p): p is CollectPhase =>
        FASI.indexOf(p as CollectPhase) !== -1)
    : undefined;

  const pipeline = await getPipelineLead(job.lead_id).catch(() => null);

  // Il dossier di prima, quando si rilanciano solo alcune fasi.
  //
  // Senza, un rilancio di sole `social_discovery` e `media` scriverebbe
  // sopra il dossier buono uno ricostruito dal nulla: Places non gira,
  // quindi non c'e ne il place_id ne il nome, e il risultato sarebbe la
  // CANCELLAZIONE di quello che il rilancio doveva integrare. Il
  // salvataggio piu sotto sostituisce la riga, non la fonde.
  const forzaRicerca = ricercaForzataAmmessa(payload);

  const precedente = solo && solo.length
    ? (await leggiDossier(job.lead_id).catch(() => null))?.dossier ?? null
    : null;

  const { dossier, phases } = await raccogli({
    lead_id: job.lead_id,
    name: ctx.name,
    city: ctx.city,
    address: ctx.address,
    phone: ctx.phone,
    email: ctx.email,
    website: ctx.website,
    place_id: pipeline?.place_id ?? "",
    manual: ctx.manual,
    linked_pages: ctx.linked_pages,
    // Solo cio che un operatore ha dichiarato fornito dal cliente puo
    // diventare `customer_owned`. Nessuna euristica ci arriva.
    media_forniti: Array.isArray(payload.media_forniti)
      ? (payload.media_forniti as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
  }, {
    solo: solo && solo.length ? solo : undefined,
    precedente,
    forzaRicerca,
    // Il budget del job e il tetto di pagine: una raccolta non puo
    // allargarsi a piacere dentro un sito grande.
    maxPagine: Math.max(1, Math.min(job.budget || 6, 10)),
  });

  await salvaDossier({ dossier, phases, job_id: job.id });

  const fallite = phases.filter((p) => p.status === "failed");
  await logActivity({
    lead_id: job.lead_id,
    type: "research",
    subject: `Raccolta dati e fotografie — ${dossier.commercial_recommendation}`
      + ` / contenuto ${dossier.content_readiness} / media ${dossier.media_readiness}`,
    body: [
      `${dossier.verified.length} fatti verificati, ${dossier.probable.length} probabili, ${dossier.conflicts.length} conflitti.`,
      `${dossier.identities.length} profili valutati, ${dossier.media.candidates.length} immagini candidate `
        + `(${dossier.media.counts.utilizzabili_in_demo} utilizzabili in demo).`,
      dossier.decision_reasons.commercial[0] ?? "",
      dossier.missing.length ? `Mancano: ${dossier.missing.join(", ")}.` : "",
      fallite.length ? `Fasi fallite: ${fallite.map((p) => `${p.phase} (${p.detail})`).join("; ")}.` : "",
      `${dossier.cost.external_calls} chiamate esterne in ${Math.round(dossier.cost.total_ms / 100) / 10}s.`,
    ].filter(Boolean).join(" "),
    metadata: {
      recommendation: dossier.commercial_recommendation,
      commercial_recommendation: dossier.commercial_recommendation,
      content_readiness: dossier.content_readiness,
      media_readiness: dossier.media_readiness,
      website_opportunity_score: dossier.website_opportunity_score,
      place_id: dossier.place_id,
      official_site: dossier.official_site,
      phases: phases.map((p) => ({ phase: p.phase, status: p.status })),
      external_calls: dossier.cost.external_calls,
    },
    created_by: "factory",
  });

  // Le fonti consultate entrano in timeline: fra sei mesi si deve poter
  // sapere da dove veniva un dato e se quel giorno era raggiungibile.
  for (const s of dossier.sources) {
    if (s.outcome === "ok") continue;
    await logActivity({
      lead_id: job.lead_id,
      type: "research",
      subject: `Fonte non utilizzabile: ${s.source_type}`,
      body: `${s.url || "(senza URL)"} — ${s.outcome}: ${s.detail}`,
      metadata: { source_type: s.source_type, outcome: s.outcome },
      created_by: "factory",
    });
  }

  if (fallite.length === phases.length) {
    throw new Error(`nessuna fase riuscita: ${fallite.map((p) => p.detail).join("; ")}`);
  }
  return `${dossier.recommendation}: ${dossier.verified.length} fatti verificati, ${dossier.media.candidates.length} immagini candidate, ${dossier.conflicts.length} conflitti`;
}

async function handleResearchBusiness(job: AgentJob): Promise<string> {
  const ctx = await leadContext(job.lead_id);
  if (!ctx) throw new FatalJobError("lead inesistente");

  // Il budget del job è il tetto di pagine scaricabili: la ricerca non
  // può allargarsi a piacere su un sito grande.
  const research = await researchBusiness(
    {
      lead_id: job.lead_id,
      name: ctx.name,
      category: ctx.category,
      city: ctx.city,
      phone: ctx.phone,
      email: ctx.email,
      address: ctx.address,
      website: ctx.website,
      maps_url: ctx.maps_url,
      rating: ctx.rating,
      reviews: ctx.reviews,
      manual: ctx.manual,
      linked_pages: ctx.linked_pages,
    },
    { maxPages: Math.max(1, Math.min(job.budget, 4)) },
  );

  // Ogni dato raccolto diventa un fatto con evidenza. Lo STATO decide se
  // è utilizzabile: `applied` per ciò che è manuale o dichiarato dal
  // sito, `proposed` per tutto il resto, che una persona deve approvare.
  for (const f of research.facts) {
    await proposeFact({
      lead_id: job.lead_id,
      field: f.field,
      value: f.value,
      band: f.band,
      source_url: f.source_url,
      method: `${f.source}/${f.method}`,
      evidence: f.evidence,
      status: f.status,
      observed_at: f.observed_at,
    });
  }

  const applied = research.facts.filter((f) => f.status === "applied").length;
  const proposed = research.facts.length - applied;

  await logActivity({
    lead_id: job.lead_id,
    type: "research",
    subject: `Ricerca: ${applied} dati verificati, ${proposed} da approvare`,
    body: [
      "Fonti consultate:",
      ...research.sources_used.map(
        (s) => `· ${s.kind}${s.url ? ` (${s.url})` : ""}: ${s.ok ? "ok" : "non riuscita"} — ${s.detail}`,
      ),
      research.conflicts.length
        ? `\nDati discordanti da controllare:\n${research.conflicts
            .map(
              (c) =>
                `· ${c.field}: tengo "${c.kept.value}" (${c.kept.source}), scartati ${c.others
                  .map((o) => `"${o.value}" (${o.source})`)
                  .join(", ")}`,
            )
            .join("\n")}`
        : "",
      research.missing.length ? `\nCampi non trovati: ${research.missing.join(", ")}` : "",
      research.rejected_images.length
        ? `\nImmagini scartate: ${research.rejected_images.length} (${research.rejected_images
            .map((r) => r.reason)
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(", ")})`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: {
      conflicts: research.conflicts,
      missing: research.missing,
      schema_types: research.schema_types,
      sources: research.sources_used,
    },
    created_by: "ai",
  });

  // La ricerca passa il testimone alla generazione portandosi dietro i
  // fatti: la generazione non rifà il lavoro e non riscarica il sito.
  await setFactoryStage(job.lead_id, "eligible");
  const project = await getOrCreateProject(job.lead_id, "generation_pending");
  await enqueueJob({
    lead_id: job.lead_id,
    kind: "generate_site",
    reason: `Ricerca completata: ${applied} dati verificati${
      research.conflicts.length ? `, ${research.conflicts.length} conflitti` : ""
    }`,
    payload: { research: research as unknown as Record<string, unknown> },
    forge_project_id: project?.id ?? "",
    priority: job.priority,
  });

  return `${applied} verificati, ${proposed} proposti, ${research.conflicts.length} conflitti`;
}

/** Trasforma i fatti della ricerca nell'input di generazione. I fatti
 *  `proposed` NON entrano: un dato non approvato non finisce in una
 *  pagina mostrata al titolare. */
function generationInputFromResearch(
  research: ResearchResult,
  fallback: GenerationInput,
): GenerationInput {
  const usable = research.facts.filter((f) => f.status === "applied");
  const pick = (field: string) => usable.find((f) => f.field === field);
  const asFact = (field: string): Fact<string> | undefined => {
    const f = pick(field);
    if (!f) return undefined;
    return {
      value: f.value,
      source: f.source_url || f.source,
      method: f.method,
      observed_at: f.observed_at,
      band: f.band,
    };
  };

  const hoursFact = pick("hours");
  const rating = pick("rating");
  const reviews = pick("review_count");

  return {
    ...fallback,
    name: asFact("name") ?? fallback.name,
    category: asFact("category") ?? fallback.category,
    address: asFact("address") ?? fallback.address,
    phone: asFact("phone") ?? fallback.phone,
    email: asFact("email") ?? fallback.email,
    maps_url: asFact("maps_url") ?? fallback.maps_url,
    description: asFact("description"),
    menu_url: asFact("menu_url"),
    hours: hoursFact
      ? {
          value: hoursFact.value.split("\n").filter(Boolean),
          source: hoursFact.source_url || hoursFact.source,
          method: hoursFact.method,
          observed_at: hoursFact.observed_at,
          band: hoursFact.band,
        }
      : fallback.hours,
    rating:
      rating && Number(rating.value) > 0
        ? {
            value: Number(rating.value),
            source: rating.source_url || rating.source,
            method: rating.method,
            observed_at: rating.observed_at,
            band: rating.band,
          }
        : fallback.rating,
    reviews_count:
      reviews && Number(reviews.value) > 0
        ? {
            value: Number(reviews.value),
            source: reviews.source_url || reviews.source,
            method: reviews.method,
            observed_at: reviews.observed_at,
            band: reviews.band,
          }
        : fallback.reviews_count,
    // SOLO i servizi con fonte: verifiedServices scarta quelli senza.
    services: verifiedServices(research).map((f) => ({
      value: f.value,
      source: f.source_url || f.source,
      method: f.method,
      observed_at: f.observed_at,
      band: f.band,
    })),
    area_served: usable
      .filter((f) => f.field === "area_served")
      .slice(0, 4)
      .map((f) => ({
        value: f.value,
        source: f.source_url || f.source,
        method: f.method,
        observed_at: f.observed_at,
        band: f.band,
      })),
    image_candidates: research.images,
    official_host: officialHostOf(research),
  };
}

function officialHostOf(research: ResearchResult): string {
  const site = research.facts.find((f) => f.field === "website");
  const url = site?.value ?? research.sources_used.find((s) => s.kind === "official_site" && s.url)?.url ?? "";
  if (!url) return "";
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return "";
  }
}

async function handleGenerateSite(job: AgentJob): Promise<string> {
  const ctx = await leadContext(job.lead_id);
  if (!ctx) throw new FatalJobError("lead inesistente");
  if (!ctx.name) throw new FatalJobError("lead senza nome: niente da generare");

  const project =
    (job.forge_project_id ? await getProject(job.forge_project_id) : null) ??
    (await getOrCreateProject(job.lead_id, "generating"));
  if (!project) throw new Error("progetto Forge non creabile (DB non configurato)");

  // Una demo valida e recente non si rigenera: la seconda costerebbe
  // come la prima e sarebbe la stessa pagina.
  const limits = loadLimits();
  if (
    hasFreshDemo({
      updatedAt: project.updated_at,
      stage: project.stage,
      qaScore: project.qa_score,
      demoFreshDays: limits.demoFreshDays,
    })
  ) {
    return `demo già pronta e recente (QA ${project.qa_score}/100): non rigenero`;
  }

  await setProjectStage(project.id, "generating");
  await setFactoryStage(job.lead_id, "generating");

  const fallbackInput = factsFromPlaces({
    lead_id: job.lead_id,
    name: ctx.name,
    category: ctx.category || "attività locale",
    address: ctx.address,
    phone: ctx.phone,
    maps_url: ctx.maps_url,
    rating: ctx.rating,
    reviews: ctx.reviews,
    city: ctx.city,
  });

  // Se la ricerca ha girato, i suoi fatti hanno la precedenza su
  // lead.meta: sono più freschi e portano la loro fonte.
  const research = job.payload.research as ResearchResult | undefined;
  const input = research?.facts
    ? generationInputFromResearch(research, fallbackInput)
    : fallbackInput;

  const { result, used_ai } = await generateSiteSpec(input);
  await saveProjectSpec(project.id, result.spec, "qa_pending");
  await setProjectDemoUrl(project.id, `${publicBaseUrl()}/preview/${project.slug}`);

  await logActivity({
    lead_id: job.lead_id,
    forge_project_id: project.id,
    type: "demo_generated",
    subject: `Bozza sito generata${used_ai ? "" : " (copy di riserva, Gemini non disponibile)"}`,
    body:
      result.dropped.length > 0
        ? `Dati scartati per mancanza di fonte o affermazioni non verificabili:\n${result.dropped
            .map((d) => `· ${d.field}: ${d.reason}`)
            .join("\n")}`
        : "Nessun dato scartato.",
    metadata: { dropped: result.dropped, used_ai },
    created_by: "ai",
  });

  await enqueueJob({
    lead_id: job.lead_id,
    kind: "run_site_qa",
    reason: "Bozza generata, da controllare prima di mostrarla",
    forge_project_id: project.id,
    priority: job.priority,
  });
  return `spec generata, ${result.dropped.length} dati scartati`;
}

async function handleRunSiteQa(job: AgentJob): Promise<string> {
  const project = job.forge_project_id ? await getProject(job.forge_project_id) : null;
  if (!project) throw new FatalJobError("progetto Forge inesistente");

  // Screenshot solo se richiesto: su serverless costa tempo e può non
  // partire, e il QA non deve dipendere dal browser per dare un verdetto.
  const wantShots = job.payload.screenshots === true;
  const report = await runQa(project.spec, {
    previewUrl: project.demo_url,
    screenshots: wantShots,
  });

  const stage: FactoryStage = report.passed ? "ready" : "qa_failed";
  await saveProjectQa(project.id, report, stage);
  await setFactoryStage(job.lead_id, stage);
  await logActivity({
    lead_id: job.lead_id,
    forge_project_id: project.id,
    type: "qa",
    subject: qaSummary(report),
    body: report.checks
      .map((c) => `${c.passed ? "ok" : c.blocking ? "BLOCCA" : "minore"} · ${c.label}${c.detail ? ` — ${c.detail}` : ""}`)
      .join("\n"),
    metadata: { score: report.score, passed: report.passed },
    created_by: "ai",
  });

  if (!report.passed) {
    // Non si ritenta da soli: una spec bocciata si ricorregge, e
    // rigenerare in loop brucerebbe quota senza cambiare il risultato.
    return `QA non superato (${report.score}/100): serve una correzione`;
  }

  await enqueueJob({
    lead_id: job.lead_id,
    kind: "prepare_outreach",
    reason: `Demo pronta (QA ${report.score}/100)`,
    forge_project_id: project.id,
    priority: job.priority,
  });
  return `QA superato (${report.score}/100)`;
}

async function handlePrepareOutreach(job: AgentJob): Promise<string> {
  const ctx = await leadContext(job.lead_id);
  if (!ctx) throw new FatalJobError("lead inesistente");
  const project = job.forge_project_id ? await getProject(job.forge_project_id) : null;
  if (!project) throw new FatalJobError("progetto Forge inesistente");

  const analysis = await analyzeWebsite(ctx.website);
  const { draft, used_ai } = await prepareOutreach({
    business_name: ctx.name,
    category: ctx.category,
    city: ctx.city,
    analysis,
    demo_url: project.demo_url,
    spec: project.spec,
  });

  await setProjectStage(project.id, "outreach_ready");
  await setFactoryStage(job.lead_id, "outreach_ready");
  await logActivity({
    lead_id: job.lead_id,
    forge_project_id: project.id,
    type: "ai_action",
    subject: "Messaggio di primo contatto pronto (da inviare a mano)",
    body: draft.whatsapp,
    metadata: { draft, used_ai },
    created_by: "ai",
  });
  await scheduleFollowup({
    lead_id: job.lead_id,
    forge_project_id: project.id,
    title: "Ricontattare dopo invio bozza",
    note: draft.reason,
    due_at: draft.next_followup_at,
  });
  return "bozza di contatto pronta";
}

async function handleScheduleFollowup(job: AgentJob): Promise<string> {
  const title = typeof job.payload.title === "string" ? job.payload.title : "Ricontattare";
  const dueAt =
    typeof job.payload.due_at === "string"
      ? job.payload.due_at
      : new Date(Date.now() + 3 * 86_400_000).toISOString();
  const res = await scheduleFollowup({
    lead_id: job.lead_id,
    forge_project_id: job.forge_project_id,
    title,
    due_at: dueAt,
    note: job.reason,
  });
  return res.created ? `promemoria creato per ${dueAt.slice(0, 10)}` : "promemoria già presente";
}

const HANDLERS: Record<JobKind, (job: AgentJob) => Promise<string>> = {
  analyze_website: handleAnalyzeWebsite,
  research_business: handleResearchBusiness,
  collect_business_intelligence: handleCollectBusinessIntelligence,
  generate_site: handleGenerateSite,
  run_site_qa: handleRunSiteQa,
  prepare_outreach: handlePrepareOutreach,
  schedule_followup: handleScheduleFollowup,
};

// ----- Worker -----------------------------------------------------

export interface RunWorkerOptions {
  batch?: number;
  kinds?: JobKind[];
  /** true = nessuna scrittura, nessuna chiamata esterna: solo il piano. */
  dryRun?: boolean;
  workerId?: string;
}

/** In dry-run si guarda la coda e si dice cosa si farebbe, senza farlo. */
async function planDryRun(opts: RunWorkerOptions): Promise<WorkerResult> {
  const { listJobs } = await import("./queue");
  const pending = await listJobs({ status: "pending", limit: opts.batch ?? DEFAULT_BATCH });
  return {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    skipped_limit: [],
    paused: isFactoryPaused(),
    recovered_leases: 0,
    details: pending
      .filter((j) => !opts.kinds?.length || opts.kinds.includes(j.kind))
      .map((j) => ({
        job_id: j.id,
        kind: j.kind,
        lead_id: j.lead_id,
        outcome: `dry-run: eseguirei ${j.kind} perché "${j.reason}"`,
      })),
  };
}

/** Esegue fino a `batch` job. Un job che fallisce non blocca gli altri. */
export interface EsitoRunNow {
  job_id: string;
  lead_id: string;
  kind: JobKind;
  /** queued -> running -> completed | failed. */
  stato: "completed" | "failed" | "not_claimed" | "paused" | "no_db";
  outcome: string;
  error: string;
  ms: number;
}

/**
 * Esegue UN job preciso, subito, fino in fondo.
 *
 * Serve all'operatore che ha premuto un bottone su un lead: accodare e
 * basta lo lascerebbe ad aspettare il cron, e `runWorker` potrebbe
 * prendere il job di un altro lead perche sceglie per priorita.
 *
 * Idempotente per costruzione: il claim e un UPDATE condizionale su
 * `status = 'pending'`. Premere due volte non esegue due volte — la
 * seconda trova il job gia preso e torna `not_claimed`.
 *
 * `FACTORY_PAUSED` viene rispettata: e l'interruttore con cui si ferma
 * tutto, e un'azione manuale non deve poterlo scavalcare. Il tetto
 * giornaliero invece no: quello governa i lotti automatici, mentre qui
 * c'e una persona che ha chiesto esplicitamente questo lead.
 */
export async function runJobNow(jobId: string): Promise<EsitoRunNow> {
  const t0 = Date.now();
  const vuoto: EsitoRunNow = {
    job_id: jobId, lead_id: "", kind: "collect_business_intelligence",
    stato: "no_db", outcome: "", error: "", ms: 0,
  };
  if (!turso) return { ...vuoto, error: "database non configurato" };
  if (isFactoryPaused()) {
    return { ...vuoto, stato: "paused", error: "FACTORY_PAUSED attiva: nessun job viene eseguito" };
  }

  await ensureFactorySchema();
  await recoverExpiredLeases();

  const workerId = `run-now-${Date.now()}`;
  const job = await claimSpecificJob(jobId, workerId);
  if (!job) {
    return { ...vuoto, stato: "not_claimed",
      error: "job non piu in attesa: e gia stato preso, e gia finito, o non esiste" };
  }

  try {
    const outcome = await HANDLERS[job.kind](job);
    await completeJob(job.id, outcome);
    return { job_id: job.id, lead_id: job.lead_id, kind: job.kind,
      stato: "completed", outcome, error: "", ms: Date.now() - t0 };
  } catch (err) {
    const message = (err as Error).message;
    const fatal = err instanceof FatalJobError;
    await failJob(job.id, message, { fatal });
    return { job_id: job.id, lead_id: job.lead_id, kind: job.kind,
      stato: "failed", outcome: "", error: message, ms: Date.now() - t0 };
  }
}

export async function runWorker(opts: RunWorkerOptions = {}): Promise<WorkerResult> {
  const batch = Math.min(Math.max(1, opts.batch ?? DEFAULT_BATCH), MAX_BATCH);
  const workerId = opts.workerId ?? `worker-${process.pid}-${Date.now()}`;

  if (opts.dryRun) return planDryRun({ ...opts, batch });

  const result: WorkerResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    skipped_limit: [],
    paused: false,
    recovered_leases: 0,
    details: [],
  };

  if (isFactoryPaused()) {
    result.paused = true;
    return result;
  }
  if (!turso) return result;

  await ensureFactorySchema();
  result.recovered_leases = await recoverExpiredLeases();

  // Tetti giornalieri calcolati una volta per giro: il limite vale per
  // il lotto, non per il singolo job.
  const allowed: JobKind[] = [];
  const limits = dailyLimits();
  const kinds = opts.kinds?.length ? opts.kinds : (Object.keys(limits) as JobKind[]);
  for (const kind of kinds) {
    if ((await jobsRunToday(kind)) >= limits[kind]) result.skipped_limit.push(kind);
    else allowed.push(kind);
  }
  if (allowed.length === 0) return result;

  for (let i = 0; i < batch; i++) {
    const job = await claimJob(workerId, allowed);
    if (!job) break;
    result.claimed++;
    try {
      const outcome = await HANDLERS[job.kind](job);
      await completeJob(job.id, outcome);
      result.succeeded++;
      result.details.push({ job_id: job.id, kind: job.kind, lead_id: job.lead_id, outcome });
    } catch (err) {
      const message = (err as Error).message;
      const fatal = err instanceof FatalJobError;
      const failure = await failJob(job.id, message, { fatal });
      result.failed++;
      result.details.push({
        job_id: job.id,
        kind: job.kind,
        lead_id: job.lead_id,
        outcome: failure.retrying ? `errore, riprovo: ${message}` : `errore definitivo: ${message}`,
      });
    }
  }

  return result;
}

/** Mette un lead in lavorazione: primo passo sempre l'analisi del sito. */
export async function enrollLead(
  leadId: string,
  reason = "lead selezionato per la Factory",
): Promise<{ enqueued: boolean; job_id: string }> {
  await ensureFactorySchema();
  await setFactoryStage(leadId, "research_pending");
  const res = await enqueueJob({
    lead_id: leadId,
    kind: "analyze_website",
    reason,
    priority: 5,
  });
  return { enqueued: res.created, job_id: res.id };
}
