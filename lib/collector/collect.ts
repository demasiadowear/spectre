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
import { scoreWebsite, type SiteProbe } from "@/lib/factory/website";
import type {
  BusinessDossier, CollectPhase, DossierConflict, DossierFact,
  ExtractionMethod, IdentityCandidate,
  MediaCandidate, PhaseState, SourceAttempt, SourceType, UsageScope,
} from "@/types/dossier";
import type { FactBand } from "@/types/factory";
import {
  providerPredefinito, type BrowserWorkerProvider, type PaginaRaccolta,
} from "./browser";
import { decidi } from "./decisione";
import { scopriProfili, type EsitoRicerca } from "./ricerca";
import {
  contestoConDichiarazioni, eUrlDiProfilo, normalizzaUrlProfilo,
  unisciCandidati, valutaProfilo,
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

/** Il pezzo di Places che il collector usa. Estratto come interfaccia
 *  per poterlo sostituire nei test: la logica di riconciliazione e di
 *  identita e la parte che vale, e non deve dipendere da una chiave API
 *  per essere verificabile. In produzione e sempre l'adapter reale. */
export interface ClientPlaces {
  dettaglio: typeof dettaglioPlace;
  cerca: typeof cercaPlace;
}

export const PLACES_REALE: ClientPlaces = { dettaglio: dettaglioPlace, cerca: cercaPlace };

export interface OpzioniCollect {
  provider?: BrowserWorkerProvider;
  places?: ClientPlaces;
  env?: NodeJS.ProcessEnv;
  /** Fasi da eseguire. Assente = tutte. Serve al rilancio dei falliti. */
  solo?: CollectPhase[];
  /** Dossier precedente, per rilanciare solo le fasi mancanti. */
  precedente?: BusinessDossier | null;
  /** La scoperta social. Sostituibile nei test: e l'unica parte del
   *  collector che parla con un modello, e va poter essere provata
   *  senza spendere interrogazioni vere. */
  ricerca?: typeof scopriProfili;
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
  // Una citazione di ricerca dice «esiste una pagina che parla di
  // questa attivita», non «questa pagina e sua». Sta sotto la soglia
  // di `probable` di proposito: da sola non deve mai bastare.
  grounded_search: 35,
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

const normalizza = (s: string) => s.toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Normalizza per capire se due valori dicono la stessa cosa. */
function stessoValore(field: string, a: string, b: string): boolean {
  if (field === "phone") return stessoTelefono(a, b);
  const x = normalizza(a), y = normalizza(b);
  if (x === y) return true;
  // «Via Sparano 10, Bari» e «Via Sparano 10, 70121 Bari BA» sono lo
  // stesso indirizzo scritto con piu o meno dettaglio. Segnalarlo come
  // conflitto bloccante e un falso allarme, e i falsi allarmi fanno
  // ignorare anche quelli veri.
  if (field === "address") {
    // Contenimento per PAROLE, non per sottostringa: «Via Sparano 10,
    // Bari» sta dentro «Via Sparano 10, 70121 Bari BA» anche se il CAP
    // si infila in mezzo. Una via diversa avrebbe parole diverse.
    const pa = x.split(" ").filter(Boolean);
    const pb = y.split(" ").filter(Boolean);
    const corte = pa.length <= pb.length ? pa : pb;
    const lunghe = pa.length <= pb.length ? pb : pa;
    return corte.length >= 2 && corte.every((t) => lunghe.indexOf(t) !== -1);
  }
  return false;
}

/** Campi che portano PIU valori per natura: piu servizi sono piu
 *  servizi, e «lunedi: chiuso» e «martedi: 12:30-15:00» sono due righe
 *  dello stesso orario, non due versioni dello stesso fatto. Metterli a
 *  confronto fra loro produce un conflitto su ogni attivita con piu di
 *  un giorno di apertura, cioe su tutte. */
const CAMPI_MULTIVALORE = ["services", "social", "images", "hours"];

/** Campi su cui un disaccordo NON si risolve da soli: un telefono
 *  sbagliato su una demo e un danno, non un dettaglio. */
const CAMPI_BLOCCANTI = ["phone", "address", "email"];

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
    if (CAMPI_MULTIVALORE.indexOf(field) !== -1) {
      // Si tolgono solo i doppioni esatti: la stessa riga dichiarata da
      // due fonti non e due righe.
      const visti: string[] = [];
      for (const f of ordinati) {
        const chiave = normalizza(f.value);
        if (visti.indexOf(chiave) !== -1) continue;
        visti.push(chiave);
        (f.band === "verified" ? verified : probable).push(f);
      }
      return;
    }

    const tenuto = ordinati[0];
    // Doppioni fra loro esclusi: due fonti che dicono la stessa cosa non
    // sono due conflitti, e lo stesso valore ripetuto tre volte nel
    // pannello fa sembrare grave cio che non lo e.
    const diversi: DossierFact[] = [];
    for (const f of ordinati.slice(1)) {
      if (stessoValore(field, f.value, tenuto.value)) continue;
      if (diversi.some((g) => stessoValore(field, g.value, f.value))) continue;
      diversi.push(f);
    }

    if (diversi.length > 0) {
      const bloccante = CAMPI_BLOCCANTI.indexOf(field) !== -1;
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
  places: ClientPlaces;
  cerca: typeof scopriProfili;
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
  /** Quanto vale rifare il sito, 0-100. `null` finche la fase sito non
   *  ha girato: «non misurato» e diverso da «zero opportunita». */
  punteggioSito: number | null;
  /** Esito della scoperta social con ricerca, per la telemetria. */
  ricerca: { esito: EsitoRicerca; queries: number; tokens: number };
  /** Candidati gia scoperti da una ricerca precedente ancora recente. */
  candidatiRicerca: string[];
  /** La ricerca non si rifa: il dossier precedente e abbastanza fresco. */
  saltaRicerca: boolean;
  /** Esito della fase media. Si riempie durante, non in ingresso. */
  media?: { candidati: MediaCandidate[]; scartati: { source_url: string; reason: string }[] };
}

function host(u: string): string {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

/**
 * Quanto vale rifare questo sito, dalla pagina che il collector ha GIA
 * scaricato.
 *
 * Si riusa il punteggio della Factory invece di riscriverne un altro:
 * due misure diverse della stessa cosa divergono al primo cambiamento e
 * poi non si sa piu a quale credere. E si riusa l'HTML gia in mano
 * invece di richiamare `analyzeWebsite`, che rifarebbe la richiesta:
 * una seconda visita allo stesso sito, per lo stesso dato, contro i
 * tetti di MAX_CHIAMATE_ESTERNE.
 */
function punteggioDaPagina(url: string, p: PaginaRaccolta): number {
  const probe: SiteProbe = {
    url: p.final_url || url,
    // Risponde = ha restituito uno status HTTP. Una pagina che serve un
    // browser ha comunque risposto: il suo problema e diverso.
    reachable: p.status > 0,
    http_status: p.status || null,
    response_ms: p.ms,
    https: /^https:/i.test(p.final_url || url),
    html: p.html,
    error: p.detail,
  };
  return scoreWebsite(probe).opportunity_score;
}

async function fasePlaces(s: Stato): Promise<string> {
  const t0 = Date.now();
  // Un place_id gia noto vale una chiamata sola e nessuna ambiguita.
  let esito = s.lead.place_id
    ? await s.places.dettaglio(s.lead.place_id, s.env)
    : await s.places.cerca([s.lead.name, s.lead.address, s.lead.city].filter(Boolean).join(", "), s.env);
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
    const pieno = await s.places.dettaglio(r.scelta.scheda.place_id, s.env);
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
    // Nessun sito non e un guasto da segnalare: e l'opportunita
    // massima, ed e il caso per cui la Factory esiste. Il punteggio si
    // registra QUI, cosi la decisione commerciale lo trova.
    s.punteggioSito = scoreWebsite(null).opportunity_score;
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
    // La home e la pagina su cui si giudica il sito: si misura sempre,
    // anche quando non e leggibile — un sito che non risponde e proprio
    // il caso in cui l'opportunita e alta.
    if (prima) s.punteggioSito = punteggioDaPagina(u, pagina);
    if (pagina.esito !== "ok" || !pagina.html) {
      if (prima) return pagina.detail || `sito non leggibile (${pagina.esito})`;
      continue;
    }

    // Si passa l'URL della pagina: senza, i `src` relativi — cioe quasi
    // tutti — verrebbero scartati prima ancora di essere valutati.
    const est = extractFromHtml(pagina.html, pagina.final_url || u);
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
      s.mediaGrezzi.push({
        url: img.value, source_page: u, platform: "website",
        alt: img.evidence, contesto: testo.slice(0, 200),
      });
    }
    for (const logo of est.logo.slice(0, 2)) {
      s.mediaGrezzi.push({ url: logo.value, source_page: u, platform: "website", alt: "logo", contesto: "logo" });
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
  /** Da dove viene ciascun URL. Un profilo LINKATO dal sito e gia
   *  mezzo verificato — e il sito a dichiararlo suo. Uno TROVATO da una
   *  ricerca non e dichiarato da nessuno, e non deve poter fingere di
   *  esserlo quando piu avanti si scrive la provenienza del fatto. */
  const provenienza: Record<string, SourceType> = {};
  for (const u of unici) provenienza[u] = "official_site";

  // Il sito non ne ha dichiarato nessuno — spesso perche un sito non
  // c'e. Si chiede a una ricerca, che pero SCOPRE soltanto: i candidati
  // che escono di qui passano dagli stessi due segnali forti di tutti
  // gli altri, senza sconti.
  if (unici.length === 0) {
    if (s.saltaRicerca) {
      for (const u of s.candidatiRicerca) {
        if (unici.indexOf(u) !== -1) continue;
        unici.push(u);
        provenienza[u] = "grounded_search";
      }
      s.sources.push({ source_type: "grounded_search", url: "", ok: true, outcome: "skipped",
        detail: `dossier ancora recente: ${s.candidatiRicerca.length} candidati riusati invece di ricercarli`,
        ms: Date.now() - t0 });
    } else {
      const r = await s.cerca({
        nome: s.scheda?.name || s.lead.name,
        citta: s.lead.city,
        indirizzo: s.scheda?.address || s.lead.address,
        telefono: s.scheda?.phone || s.lead.phone,
        categoria: s.scheda?.category || "",
      });
      s.ricerca = { esito: r.esito, queries: r.queries_used, tokens: r.tokens };
      for (const c of r.candidati) {
        if (unici.indexOf(c.url) !== -1) continue;
        unici.push(c.url);
        provenienza[c.url] = "grounded_search";
      }
      s.sources.push({
        source_type: "grounded_search",
        url: `gemini:google_search(${r.queries_used})`,
        ok: r.esito === "ok",
        outcome: r.esito === "ok" ? "ok" : r.esito === "no_results" ? "not_found" : "skipped",
        detail: r.detail || `${r.candidati.length} candidati dalle citazioni`,
        ms: r.ms,
      });
    }
  }

  if (unici.length === 0) {
    s.sources.push({ source_type: "social_profile", url: "", ok: true, outcome: "not_found",
      detail: "nessun profilo ne linkato dal sito ne trovato dalla ricerca", ms: Date.now() - t0 });
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
      discovered_via: provenienza[u] ?? "official_site",
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
    const daRicerca = c.discovered_via === "grounded_search";
    s.fatti.push(fatto(
      "social", c.candidate_url,
      daRicerca ? "grounded_search" : "official_site",
      daRicerca ? "search_citation" : "link_href",
      daRicerca ? "" : s.official_site,
      daRicerca
        ? `citato da una ricerca, non dichiarato dal sito — ${c.status}`
        : `link dichiarato dal sito — ${c.status}`,
      "internal_review",
    ));
  }
  return "";
}

async function faseMedia(s: Stato): Promise<string> {
  const ufficiali = s.identita
    .filter((c) => c.status === "confirmed")
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

const CAMPI_ATTESI = ["name", "address", "phone", "category", "hours", "website", "services", "email"];

/** Oltre questo tempo una scoperta social e da rifare. Sotto, si
 *  riusa: le pagine social non nascono ogni settimana, e ogni ricerca
 *  in piu e denaro speso per riconfermare la stessa cosa. */
export const FRESCHEZZA_RICERCA_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Rimette nello stato quello che le fasi SALTATE avrebbero prodotto.
 *
 * Senza questo, rilanciare solo `social_discovery` e `media` produce un
 * dossier vuoto: `scheda`, `official_site` e i fatti li riempie la fase
 * Places, che in un rilancio parziale non gira. Il risultato sarebbe un
 * dossier peggiore del precedente — cioe il rilancio distruggerebbe
 * proprio cio che doveva integrare.
 *
 * Si reidrata SOLO cio che non viene rifatto: quello che le fasi
 * richieste ricalcolano deve restare vuoto, altrimenti il vecchio si
 * somma al nuovo e i conflitti si moltiplicano da soli.
 */
function reidrata(s: Stato, p: BusinessDossier, esegui: CollectPhase[]): void {
  const salta = (f: CollectPhase) => esegui.indexOf(f) === -1;

  if (salta("places")) {
    s.official_site = p.official_site;
    s.official_host = p.official_host;
    // La scheda Places non si conserva per intero nel dossier: si
    // ricostruisce il minimo che serve alle fasi successive, senza
    // inventare i campi che non ci sono.
    const val = (campo: string) =>
      p.verified.concat(p.probable).find((f) => f.field === campo)?.value ?? "";
    s.scheda = {
      place_id: p.place_id,
      name: val("name"),
      address: val("address"),
      phone: val("phone"),
      website: p.official_site,
      category: val("category"),
      maps_url: val("maps_url"),
      phone_international: "", types: [], summary: "",
      rating: 0, reviews: 0, business_status: val("business_status"),
      hours: [], photos: [], lat: 0, lng: 0,
    };
  }
  if (salta("official_site")) {
    s.official_site = p.official_site;
    s.official_host = p.official_host;
    s.punteggioSito = p.website_opportunity_score;
  }

  // I fatti delle fasi saltate: si riprendono quelli, e solo quelli.
  const daFasiSaltate = (f: DossierFact): boolean => {
    if (f.source_type === "google_places") return salta("places");
    if (f.source_type === "social_profile" || f.source_type === "grounded_search") {
      return salta("social_discovery");
    }
    if (f.source_type === "official_site" && f.field === "social") return salta("social_discovery");
    if (/^(official_site|site_structured|site_meta|site_text)$/.test(f.source_type)) {
      return salta("official_site");
    }
    return false;
  };
  for (const f of p.verified.concat(p.probable)) {
    if (daFasiSaltate(f)) s.fatti.push(f);
  }

  if (salta("social_discovery")) {
    s.identita = p.identities;
    // I profili gia confermati restano il punto di partenza dei media.
    for (const c of p.identities) s.linkSocial.push(c.candidate_url);
  } else {
    // La ricerca si rifa solo se il dossier non e piu recente.
    const eta = Date.now() - Date.parse(p.generated_at || "");
    const recente = Number.isFinite(eta) && eta >= 0 && eta < FRESCHEZZA_RICERCA_MS;
    const giaCercato = p.sources.some((x) => x.source_type === "grounded_search");
    if (recente && giaCercato) {
      s.saltaRicerca = true;
      // Si riparte dai candidati gia scoperti: la scoperta si riusa, la
      // VERIFICA si rifa comunque, perche e quella che decide. Restano
      // in una lista a parte da `linkSocial`: un profilo TROVATO da una
      // ricerca non deve poter entrare nel dossier come profilo
      // DICHIARATO dal sito.
      for (const c of p.identities) {
        if (c.discovered_via === "grounded_search") s.candidatiRicerca.push(c.candidate_url);
      }
    }
  }

  if (salta("media")) {
    s.media = { candidati: p.media.candidates, scartati: p.media.rejected };
  } else {
    // La fase media si RIFA, ma le immagini grezze le producono Places
    // e il sito: se quelle fasi sono saltate, `mediaGrezzi` resta vuoto
    // e la fase ricostruisce un manifest di zero fotografie.
    //
    // E il caso peggiore di tutti, perche non sembra un guasto: il
    // pannello direbbe «nessuna immagine candidata» su un'attivita che
    // ne aveva dieci, e sembrerebbe una risposta vera. Si ricostruisce
    // il grezzo dai candidati precedenti, che portano gia il
    // riferimento del provider e l'attribuzione.
    for (const m of p.media.candidates) {
      const daPlaces = Boolean(m.provider_reference);
      if (daPlaces ? !salta("places") : !salta("official_site")) continue;
      s.mediaGrezzi.push({
        url: m.source_url,
        source_page: m.source_page,
        platform: m.platform,
        provider_reference: m.provider_reference || undefined,
        attribution: m.attribution,
        width: m.width,
        height: m.height,
      });
    }
  }
  for (const src of p.sources) {
    if (src.source_type === "google_places" && salta("places")) s.sources.push(src);
  }
}

export async function raccogli(
  lead: LeadInput,
  opts: OpzioniCollect = {},
): Promise<EsitoCollect> {
  const t0 = Date.now();
  const s: Stato = {
    lead,
    provider: opts.provider ?? providerPredefinito(opts.env),
    places: opts.places ?? PLACES_REALE,
    cerca: opts.ricerca ?? scopriProfili,
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
    punteggioSito: null,
    ricerca: { esito: "ok", queries: 0, tokens: 0 },
    candidatiRicerca: [],
    saltaRicerca: false,
  };

  // Le correzioni manuali entrano per prime e vincono su tutto: sono
  // state messe da una persona proprio per correggere l'automazione.
  for (const [campo, valore] of Object.entries(lead.manual)) {
    if (valore) s.fatti.push(fatto(campo, valore, "manual", "manual_entry", "", "inserito a mano in SPECTER"));
  }

  const esegui: CollectPhase[] = opts.solo ?? ["places", "official_site", "social_discovery", "media", "reconcile"];
  if (opts.precedente) reidrata(s, opts.precedente, esegui);

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
    website_opportunity_score: s.punteggioSito,
    // Segnaposto: le tre decisioni si prendono sul dossier finito, un
    // attimo piu sotto. Servono qui solo perche il tipo sia completo.
    commercial_recommendation: "REVIEW",
    content_readiness: "BLOCKED",
    media_readiness: "NONE",
    decision_reasons: { commercial: [], content: [], media: [] },
    recommendation: "REVIEW",
    recommendation_reasons: [],
    cost: { external_calls: s.chiamate, total_ms: Date.now() - t0 },
    search: { status: s.ricerca.esito, queries: s.ricerca.queries, tokens: s.ricerca.tokens },
  };

  const d = decidi(dossier);
  dossier.commercial_recommendation = d.commercial_recommendation;
  dossier.content_readiness = d.content_readiness;
  dossier.media_readiness = d.media_readiness;
  dossier.decision_reasons = d.reasons;
  // Campi storici: restano allineati alla decisione COMMERCIALE, che e
  // quella che il vecchio campo cercava di esprimere. Cosi un dossier
  // gia salvato e uno nuovo si leggono con lo stesso codice.
  dossier.recommendation = d.commercial_recommendation;
  dossier.recommendation_reasons =
    d.reasons.commercial.concat(d.reasons.content, d.reasons.media);

  phases.push({ phase: "reconcile", status: "ok",
    detail: `${verified.length} verificati, ${probable.length} probabili, ${conflicts.length} conflitti`, ms: 0 });

  return { dossier, phases };
}
