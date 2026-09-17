// ============================================================
// Il collector: da un lead_id a un BusinessDossier.
//
// Cinque fasi in ordine, perche ognuna ha bisogno della precedente:
//
//   places  ->  official_site  ->  social_discovery  ->  media  ->  reconcile
//
// Places da l'ancora (place_id, sito dichiarato, telefono). Il sito
// ufficiale si riconosce a partire da li, non da una ricerca. I social
// si scoprono dai link SUL sito, che e anche cio che li rende
// verificabili: e il sito stesso a dichiararli suoi. I media arrivano
// dal sito e dai profili gia verificati. La riconciliazione mette
// insieme e dichiara i conflitti.
//
// Ogni fase registra esito e durata, e puo fallire senza fermare le
// altre: un dossier parziale con le lacune dichiarate vale piu di
// nessun dossier. Le fasi fallite si rilanciano da sole.
//
// Nessun URL arbitrario entra da fuori: si parte da un lead_id, e gli
// URL che si visitano vengono da Places o dall'HTML del sito
// ufficiale, ciascuno passato dalla guardia SSRF.
// ============================================================

import { extractFromHtml, visibleText } from "@/lib/factory/extract";
import type {
  BusinessDossier, CollectPhase, DossierConflict, DossierFact,
  DossierRecommendation, ExtractionMethod, IdentityCandidate,
  MediaCandidate, PhaseState, SourceAttempt, SourceType, UsageScope,
} from "@/types/dossier";
import type { FactBand } from "@/types/factory";
import { providerPredefinito, type BrowserWorkerProvider } from "./browser";
import {
  contestoConDichiarazioni, eUrlDiProfilo, normalizzaUrlProfilo,
  piattaformaDi, unisciCandidati, valutaProfilo,
} from "./identity";
import {
  costruisciCandidati, manifestDa, type CandidatoGrezzo, type ContestoMedia,
} from "./media";
import {
  cercaPlace, dettaglioPlace, risolviCorrispondenza, stessoTelefono,
  urlFotoProvider, type PlacesScheda,
} from "./places";

export const DOSSIER_VERSION = 1;

/** Tetti: il collector gira su un lead vero e non deve poter scavare
 *  senza fine dentro un sito altrui. */
export const MAX_PAGINE_SITO = 6;
export const MAX_CHIAMATE_ESTERNE = 20;

/** Pagine che di solito contengono cio che serve. Si provano solo se
 *  linkate dalla home: non si indovinano URL. */
const PAGINE_UTILI = /\b(chi-siamo|chi siamo|about|servizi|services|menu|carta|listino|trattament|prodotti|contatt|dove-siamo|team|staff|prenota|booking)\b/i;

export interface LeadInput {
  lead_id: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  place_id: string;
  lat?: number;
  lng?: number;
  /** Correzioni manuali: hanno la precedenza su tutto. */
  manual: Record<string, string>;
  /** Pagine collegate a mano dall'operatore. */
  linked_pages: string[];
  /** URL di immagini che l'operatore dichiara fornite dal cliente. */
  media_forniti: string[];
}

export interface OpzioniCollect {
  provider?: BrowserWorkerProvider;
  env?: NodeJS.ProcessEnv;
  /** Fasi da eseguire. Assente = tutte. Serve al rilancio dei falliti. */
  solo?: CollectPhase[];
  /** Dossier precedente, per rilanciare solo le fasi mancanti. */
  precedente?: BusinessDossier | null;
  maxPagine?: number;
}

export interface EsitoCollect {
  dossier: BusinessDossier;
  phases: PhaseState[];
}

// ----- Costruzione dei fatti -------------------------------------

const ORA = () => new Date().toISOString();

/** Confidenza numerica per tipo di fonte e metodo. La banda resta la
 *  sintesi leggibile: si deriva da qui, non viceversa. */
const CONFIDENZA: Record<SourceType, number> = {
  manual: 100,
  google_places: 90,
  official_site: 85,
  site_structured: 88,
  lead: 70,
  site_meta: 65,
  social_profile: 60,
  linked_page: 55,
  site_text: 45,
};

export function bandaDa(confidence: number): FactBand {
  if (confidence >= 80) return "verified";
  if (confidence >= 55) return "probable";
  return "possible";
}

function fatto(
  field: string,
  value: string,
  source_type: SourceType,
  extraction_method: ExtractionMethod,
  source_url: string,
  evidence: string,
  usage_scope: UsageScope = "public",
): DossierFact {
  const confidence = CONFIDENZA[source_type];
  return {
    field, value,
    source: source_type,
    source_type, source_url,
    method: extraction_method,
    extraction_method,
    observed_at: ORA(),
    band: bandaDa(confidence),
    confidence,
    evidence: evidence.slice(0, 300),
    conflict_group: field,
    usage_scope,
    status: "proposed",
  };
}

/** Normalizza per capire se due valori dicono la stessa cosa. */
function stessoValore(field: string, a: string, b: string): boolean {
  if (field === "phone") return stessoTelefono(a, b);
  const n = (s: string) => s.toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return n(a) === n(b);
}

/** Campi su cui un disaccordo NON si risolve da soli: un telefono
 *  sbagliato su una demo e un danno, non un dettaglio. */
const CAMPI_BLOCCANTI = new Set(["phone", "address", "hours", "email"]);

export function riconcilia(candidati: DossierFact[]): {
  verified: DossierFact[];
  probable: DossierFact[];
  conflicts: DossierConflict[];
} {
  const perCampo = new Map<string, DossierFact[]>();
  for (const f of candidati) {
    if (!f.value.trim()) continue;
    (perCampo.get(f.field) ?? perCampo.set(f.field, []).get(f.field)!).push(f);
  }

  const verified: DossierFact[] = [];
  const probable: DossierFact[] = [];
  const conflicts: DossierConflict[] = [];

  perCampo.forEach((lista, field) => {
    const ordinati = lista.slice().sort((a, b) => b.confidence - a.confidence);
    // I campi multi-valore non hanno conflitti: piu servizi sono piu
    // servizi, non due versioni dello stesso fatto.
    if (field === "services" || field === "social" || field === "images") {
      for (const f of ordinati) (f.band === "verified" ? verified : probable).push(f);
      return;
    }

    const tenuto = ordinati[0];
    const diversi = ordinati.slice(1).filter((f) => !stessoValore(field, f.value, tenuto.value));

    if (diversi.length > 0) {
      const bloccante = CAMPI_BLOCCANTI.has(field);
      conflicts.push({
        field,
        conflict_group: field,
        kept: { value: tenuto.value, source_type: tenuto.source_type, confidence: tenuto.confidence },
        others: diversi.map((f) => ({ value: f.value, source_type: f.source_type, confidence: f.confidence })),
        blocking: bloccante,
      });
      // Un campo conteso non entra fra i verificati nemmeno se la fonte
      // e alta: e conteso, e va deciso da una persona.
      probable.push({ ...tenuto, band: "probable", status: "proposed" });
      return;
    }
    (tenuto.band === "verified" ? verified : probable).push(tenuto);
  });

  return { verified, probable, conflicts };
}

// ----- Fasi -------------------------------------------------------

interface Stato {
  lead: LeadInput;
  provider: BrowserWorkerProvider;
  env: NodeJS.ProcessEnv;
  fatti: DossierFact[];
  identita: IdentityCandidate[];
  mediaGrezzi: CandidatoGrezzo[];
  sources: SourceAttempt[];
  scheda: PlacesScheda | null;
  official_site: string;
  official_host: string;
  linkSocial: string[];
  chiamate: number;
  maxPagine: number;
  /** Esito della fase media. Si riempie durante, non in ingresso. */
  media?: { candidati: MediaCandidate[]; scartati: { source_url: string; reason: string }[] };
}

function host(u: string): string {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

async function fasePlaces(s: Stato): Promise<string> {
  const t0 = Date.now();
  // Un place_id gia noto vale una chiamata sola e nessuna ambiguita.
  let esito = s.lead.place_id
    ? await dettaglioPlace(s.lead.place_id, s.env)
    : await cercaPlace([s.lead.name, s.lead.address, s.lead.city].filter(Boolean).join(", "), s.env);
  s.chiamate += esito.calls;

  if (!s.lead.place_id) {
    if (!esito.ok) {
      s.sources.push({ source_type: "google_places", url: "places:searchText", ok: false,
        outcome: esito.error.includes("non configurata") ? "skipped" : "error",
        detail: esito.error || "nessun risultato", ms: Date.now() - t0 });
      return esito.error || "nessun risultato da Places";
    }
    const r = risolviCorrispondenza(
      { name: s.lead.name, city: s.lead.city, address: s.lead.address, phone: s.lead.phone, lat: s.lead.lat, lng: s.lead.lng },
      esito.candidati,
    );
    if (!r.scelta) {
      s.sources.push({ source_type: "google_places", url: "places:searchText", ok: false,
        outcome: "not_found", detail: r.motivo, ms: Date.now() - t0 });
      return `corrispondenza non sicura: ${r.motivo}`;
    }
    // Ricarica la scheda completa: la ricerca ha una FieldMask ridotta.
    const pieno = await dettaglioPlace(r.scelta.scheda.place_id, s.env);
    s.chiamate += pieno.calls;
    if (pieno.ok) esito = pieno;
    else esito = { ...esito, scheda: r.scelta.scheda, ok: true };
  }

  const sc = esito.scheda;
  if (!sc) {
    s.sources.push({ source_type: "google_places", url: "places:details", ok: false,
      outcome: "error", detail: esito.error, ms: Date.now() - t0 });
    return esito.error || "scheda vuota";
  }
  s.scheda = sc;

  const url = sc.maps_url || `https://www.google.com/maps/place/?q=place_id:${sc.place_id}`;
  const ev = `Places ${sc.place_id}`;
  const push = (f: string, v: string, scope: UsageScope = "public") => {
    if (v) s.fatti.push(fatto(f, v, "google_places", "places_details", url, ev, scope));
  };
  push("name", sc.name);
  push("address", sc.address);
  push("phone", sc.phone);
  push("website", sc.website);
  push("category", sc.category);
  push("maps_url", sc.maps_url);
  push("business_status", sc.business_status);
  if (sc.lat && sc.lng) push("coordinates", `${sc.lat},${sc.lng}`);
  if (sc.rating) push("rating", String(sc.rating), "internal_review");
  if (sc.reviews) push("reviews", String(sc.reviews), "internal_review");
  for (const riga of sc.hours) push("hours", riga);

  // Le foto Places entrano come riferimenti, mai come file.
  for (const f of sc.photos.slice(0, 10)) {
    s.mediaGrezzi.push({
      url: urlFotoProvider(f.name),
      source_page: url,
      platform: "google_maps",
      provider_reference: f.name,
      attribution: f.attributions.join(", "),
      width: f.widthPx,
      height: f.heightPx,
      contesto: `${sc.name} ${sc.category}`,
    });
  }

  s.sources.push({ source_type: "google_places", url, ok: true, outcome: "ok",
    detail: `${sc.name} — ${sc.photos.length} riferimenti fotografici`, ms: Date.now() - t0 });
  return "";
}

async function faseSitoUfficiale(s: Stato): Promise<string> {
  const t0 = Date.now();
  // Il sito ufficiale e quello dichiarato da Places o gia sul lead. Non
  // si cerca su Google e non si indovina un dominio dal nome.
  const candidato = s.scheda?.website || s.lead.website || s.lead.manual.website || "";
  if (!candidato) {
    s.sources.push({ source_type: "official_site", url: "", ok: false, outcome: "not_found",
      detail: "nessun sito dichiarato ne da Places ne dal lead", ms: Date.now() - t0 });
    return "nessun sito ufficiale dichiarato";
  }

  s.official_site = candidato;
  s.official_host = host(candidato);

  const visitate: string[] = [];
  const daVisitare = [candidato];
  let prima = true;

  while (daVisitare.length && visitate.length < s.maxPagine && s.chiamate < MAX_CHIAMATE_ESTERNE) {
    const u = daVisitare.shift()!;
    if (visitate.includes(u)) continue;
    // Solo pagine dello stesso sito: il collector non scavalca il
    // dominio dichiarato.
    if (host(u) !== s.official_host) continue;
    visitate.push(u);

    const pagina = await s.provider.apri(u);
    s.chiamate++;
    s.sources.push({
      source_type: "official_site", url: u, ok: pagina.esito === "ok",
      outcome: pagina.esito === "ok" ? "ok" : pagina.esito,
      detail: pagina.detail || `HTTP ${pagina.status}`, ms: pagina.ms,
    });
    if (pagina.esito !== "ok" || !pagina.html) {
      if (prima) return pagina.detail || `sito non leggibile (${pagina.esito})`;
      continue;
    }

    const est = extractFromHtml(pagina.html);
    const testo = visibleText(pagina.html);

    const aggiungi = (campo: string, voci: { value: string; method: string; evidence: string }[], scope: UsageScope = "public") => {
      for (const v of voci.slice(0, campo === "services" ? 12 : 3)) {
        const tipo: SourceType =
          v.method === "json_ld" || v.method === "microdata" ? "site_structured"
          : v.method === "meta" ? "site_meta"
          : v.method === "link" ? "official_site" : "site_text";
        const metodo: ExtractionMethod =
          v.method === "json_ld" ? "json_ld" : v.method === "microdata" ? "microdata"
          : v.method === "meta" ? "meta_tag" : v.method === "link" ? "link_href" : "text_pattern";
        s.fatti.push(fatto(campo, v.value, tipo, metodo, u, v.evidence, scope));
      }
    };

    if (prima) {
      aggiungi("name", est.name);
      aggiungi("description", est.description);
      aggiungi("category", est.category);
    }
    aggiungi("phone", est.phone);
    aggiungi("email", est.email);
    aggiungi("address", est.address);
    aggiungi("services", est.services);
    aggiungi("booking_url", est.booking_url);
    aggiungi("menu_url", est.menu_url);
    for (const h of est.hours.slice(0, 2)) {
      for (const riga of h.value.slice(0, 7)) {
        s.fatti.push(fatto("hours", riga, "site_structured", "json_ld", u, h.evidence));
      }
    }

    // Social dichiarati dal sito: e questo che li rende verificabili.
    for (const soc of est.social) {
      if (eUrlDiProfilo(soc.value)) s.linkSocial.push(normalizzaUrlProfilo(soc.value));
    }

    // Immagini: candidati, non asset.
    for (const img of est.images.slice(0, 20)) {
      let assoluto = img.value;
      try { assoluto = new URL(img.value, u).toString(); } catch { continue; }
      s.mediaGrezzi.push({
        url: assoluto, source_page: u, platform: "website",
        alt: img.evidence, contesto: testo.slice(0, 200),
      });
    }
    for (const logo of est.logo.slice(0, 2)) {
      let assoluto = logo.value;
      try { assoluto = new URL(logo.value, u).toString(); } catch { continue; }
      s.mediaGrezzi.push({ url: assoluto, source_page: u, platform: "website", alt: "logo", contesto: "logo" });
    }

    // Pagine interne che di solito contengono servizi e contatti. Solo
    // quelle LINKATE: non si tirano a indovinare URL.
    if (prima) {
      const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi;
      const href: RegExpExecArray[] = [];
      for (let m = re.exec(pagina.html); m; m = re.exec(pagina.html)) href.push(m);
      for (const m of href) {
        const testoLink = m[2].replace(/<[^>]+>/g, " ");
        if (!PAGINE_UTILI.test(`${m[1]} ${testoLink}`)) continue;
        try {
          const abs = new URL(m[1], u).toString();
          if (host(abs) === s.official_host && !daVisitare.includes(abs)) daVisitare.push(abs);
        } catch { /* href non valido: si ignora */ }
      }
    }
    prima = false;
  }

  // Le pagine collegate a mano dall'operatore valgono come dichiarate.
  for (const p of s.lead.linked_pages) {
    if (eUrlDiProfilo(p)) s.linkSocial.push(normalizzaUrlProfilo(p));
  }

  return visitate.length === 0 ? "nessuna pagina leggibile" : "";
}

async function faseSocial(s: Stato): Promise<string> {
  const t0 = Date.now();
  const ctx = contestoConDichiarazioni({
    nome: s.scheda?.name || s.lead.name,
    citta: s.lead.city,
    indirizzo: s.scheda?.address || s.lead.address,
    telefono: s.scheda?.phone || s.lead.phone,
    place_id: s.scheda?.place_id || s.lead.place_id,
    maps_url: s.scheda?.maps_url || "",
    official_host: s.official_host,
  }, s.linkSocial);

  const unici = s.linkSocial.filter((u, i) => s.linkSocial.indexOf(u) === i);
  if (unici.length === 0) {
    s.sources.push({ source_type: "social_profile", url: "", ok: true, outcome: "not_found",
      detail: "nessun profilo linkato dal sito ufficiale: nessuna ricerca tentata", ms: Date.now() - t0 });
    return "";
  }

  const valutati: IdentityCandidate[] = [];
  for (const u of unici) {
    if (s.chiamate >= MAX_CHIAMATE_ESTERNE) break;
    const pagina = await s.provider.apri(u);
    s.chiamate++;
    const testo = pagina.html ? visibleText(pagina.html) : "";
    const linkEsterni: string[] = [];
    if (pagina.html) {
      const reLink = /https?:\/\/[^\s"'<>]+/g;
      for (let m = reLink.exec(pagina.html); m && linkEsterni.length < 60; m = reLink.exec(pagina.html)) {
        linkEsterni.push(m[0]);
      }
    }
    valutati.push(valutaProfilo({
      url: u,
      discovered_via: "official_site",
      testo,
      link_esterni: linkEsterni,
      browser_required: pagina.esito === "browser_required",
    }, ctx));
    s.sources.push({
      source_type: "social_profile", url: u, ok: pagina.esito === "ok",
      outcome: pagina.esito === "ok" ? "ok" : pagina.esito,
      detail: pagina.detail, ms: pagina.ms,
    });
  }

  s.identita = unisciCandidati(valutati);
  for (const c of s.identita) {
    s.fatti.push(fatto("social", c.candidate_url, "official_site", "link_href",
      s.official_site, `link dichiarato dal sito — ${c.status}`, "internal_review"));
  }
  return "";
}

async function faseMedia(s: Stato): Promise<string> {
  const ufficiali = s.identita
    .filter((c) => c.status === "verified")
    .map((c) => host(c.candidate_url))
    .filter(Boolean);

  const ctx: ContestoMedia = {
    official_host: s.official_host,
    host_ufficiali: ufficiali,
    forniti_dal_cliente: s.lead.media_forniti,
    nome_attivita: s.scheda?.name || s.lead.name,
    categoria: s.scheda?.category || "",
  };
  // Senza storage i byte non si conservano (ADR-001): si costruisce il
  // manifest sui riferimenti. Lo SHA-256 resta vuoto e il manifest lo
  // dichiara, invece di far finta di averlo calcolato.
  s.media = costruisciCandidati(s.mediaGrezzi, ctx);
  return "";
}

// ----- Orchestrazione --------------------------------------------

function raccomanda(d: BusinessDossier): { r: DossierRecommendation; motivi: string[] } {
  const motivi: string[] = [];
  const bloccanti = d.conflicts.filter((c) => c.blocking);

  if (!d.place_id) motivi.push("nessuna corrispondenza sicura su Google Places: manca l'ancora del dossier");
  if (bloccanti.length) {
    motivi.push(`${bloccanti.length} conflitti su campi critici (${bloccanti.map((c) => c.field).join(", ")}): li decide una persona`);
  }
  if (!d.official_site) motivi.push("nessun sito ufficiale dichiarato: servizi e identita visiva mancano");
  const daApprovare = d.media.candidates.filter((c) => c.allowed_scope === "preview_only").length;
  if (daApprovare) motivi.push(`${daApprovare} immagini utilizzabili solo nella demo privata finche non sono approvate`);
  const incerti = d.identities.filter((c) => c.status === "ambiguous" || c.status === "browser_required");
  if (incerti.length) motivi.push(`${incerti.length} profili non decisi (ambigui o non leggibili senza browser)`);
  if (d.missing.length) motivi.push(`campi mancanti: ${d.missing.join(", ")}`);

  if (!d.place_id && !d.official_site) {
    return { r: "REJECT", motivi: [...motivi, "senza Places e senza sito non c'e niente di verificabile su cui costruire"] };
  }
  if (bloccanti.length || !d.place_id || incerti.length > 0 || daApprovare > 0) {
    return { r: "REVIEW", motivi };
  }
  return { r: "GO", motivi: motivi.length ? motivi : ["nessun conflitto, nessun profilo incerto, nessun media in attesa"] };
}

const CAMPI_ATTESI = ["name", "address", "phone", "category", "hours", "website", "services", "email"];

export async function raccogli(
  lead: LeadInput,
  opts: OpzioniCollect = {},
): Promise<EsitoCollect> {
  const t0 = Date.now();
  const s: Stato = {
    lead,
    provider: opts.provider ?? providerPredefinito(opts.env),
    env: opts.env ?? process.env,
    fatti: [],
    identita: [],
    mediaGrezzi: [],
    sources: [],
    scheda: null,
    official_site: "",
    official_host: "",
    linkSocial: [],
    chiamate: 0,
    maxPagine: opts.maxPagine ?? MAX_PAGINE_SITO,
  };

  // Le correzioni manuali entrano per prime e vincono su tutto: sono
  // state messe da una persona proprio per correggere l'automazione.
  for (const [campo, valore] of Object.entries(lead.manual)) {
    if (valore) s.fatti.push(fatto(campo, valore, "manual", "manual_entry", "", "inserito a mano in SPECTER"));
  }

  const esegui: CollectPhase[] = opts.solo ?? ["places", "official_site", "social_discovery", "media", "reconcile"];
  const phases: PhaseState[] = [];
  const corri = async (phase: CollectPhase, f: () => Promise<string>) => {
    if (esegui.indexOf(phase) === -1) {
      phases.push({ phase, status: "skipped", detail: "non richiesta in questo rilancio", ms: 0 });
      return;
    }
    const t = Date.now();
    try {
      const errore = await f();
      phases.push({ phase, status: errore ? "failed" : "ok", detail: errore, ms: Date.now() - t });
    } catch (e) {
      phases.push({ phase, status: "failed", detail: (e as Error).message, ms: Date.now() - t });
    }
  };

  await corri("places", () => fasePlaces(s));
  await corri("official_site", () => faseSitoUfficiale(s));
  await corri("social_discovery", () => faseSocial(s));
  await corri("media", () => faseMedia(s));

  const { verified, probable, conflicts } = riconcilia(s.fatti);
  const presenti = verified.concat(probable).map((f) => f.field);
  const missing = CAMPI_ATTESI.filter((c) => presenti.indexOf(c) === -1);

  const dossier: BusinessDossier = {
    dossier_version: DOSSIER_VERSION,
    lead_id: lead.lead_id,
    generated_at: ORA(),
    place_id: s.scheda?.place_id ?? "",
    official_site: s.official_site,
    official_host: s.official_host,
    verified, probable, conflicts, missing,
    identities: s.identita,
    media: manifestDa(lead.lead_id, s.media ?? { candidati: [], scartati: [] }),
    sources: s.sources,
    recommendation: "REVIEW",
    recommendation_reasons: [],
    cost: { external_calls: s.chiamate, total_ms: Date.now() - t0 },
  };
  const { r, motivi } = raccomanda(dossier);
  dossier.recommendation = r;
  dossier.recommendation_reasons = motivi;

  phases.push({ phase: "reconcile", status: "ok",
    detail: `${verified.length} verificati, ${probable.length} probabili, ${conflicts.length} conflitti`, ms: 0 });

  return { dossier, phases };
}
