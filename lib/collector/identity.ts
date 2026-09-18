// ============================================================
// A chi appartiene davvero questo profilo.
//
// Il modo sbagliato di farlo e cercare il nome dell'attivita su una
// piattaforma e prendere il primo risultato. Produce dossier che
// sembrano completi e sono sbagliati, e l'errore si scopre quando la
// demo mostra le foto di un'altra attivita.
//
// Qui un profilo diventa `verified` solo con DUE segnali forti fra:
// stesso dominio, stesso telefono, stesso indirizzo, link reciproco,
// stesso place_id, username dichiarato dal sito ufficiale.
//
// Nome simile e stessa citta sono segnali DEBOLI. Da soli, e anche
// insieme, non portano oltre `probable`: in una citta media ci sono
// cinque «Bar Centrale», e tutti hanno un nome simile e la stessa
// citta.
// ============================================================

import {
  SEGNALI_FORTI,
  type IdentityCandidate,
  type IdentitySignal,
  type IdentityStatus,
  type Platform,
  type SourceType,
} from "@/types/dossier";
import { normalizzaNome, stessoTelefono } from "./places";

/** Piattaforma dedotta dall'host. `altro` non e un fallimento: e un
 *  profilo su una piattaforma che non trattiamo ancora. */
export function piattaformaDi(url: string): Platform {
  let h: string;
  try {
    h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "altro";
  }
  if (h.endsWith("instagram.com")) return "instagram";
  if (h.endsWith("facebook.com") || h.endsWith("fb.com") || h.endsWith("fb.me")) return "facebook";
  if (h.endsWith("tiktok.com")) return "tiktok";
  if (h.endsWith("youtube.com") || h.endsWith("youtu.be")) return "youtube";
  if (h.endsWith("linkedin.com")) return "linkedin";
  if (h.endsWith("google.com") || h.endsWith("goo.gl") || h.endsWith("maps.app.goo.gl")) return "google_maps";
  return "altro";
}

/** Percorsi che NON sono un profilo: un post, una storia, un pulsante di
 *  condivisione. Prenderli per profili e l'errore piu comune quando si
 *  raccolgono i link da una pagina. */
const NON_PROFILO: Record<string, RegExp> = {
  instagram: /^\/(p|reel|reels|tv|stories|explore|accounts|share|embed|direct)(\/|$)/i,
  facebook: /^\/(sharer|share|dialog|plugins|tr|login|policy|privacy|help|watch|photo|events|groups)(\.php)?(\/|$)/i,
  tiktok: /^\/(video|tag|music|discover|embed)(\/|$)/i,
  youtube: /^\/(watch|embed|results|shorts|playlist|channel\/UC[^/]*\/(videos|about))(\/|$)/i,
  linkedin: /^\/(posts|feed|shareArticle|sharing|pulse)(\/|$)/i,
};

/** Il nome utente dentro l'URL di un profilo, quando c'e. */
export function usernameDa(url: string): string {
  try {
    const u = new URL(url);
    const piattaforma = piattaformaDi(url);
    const skip = NON_PROFILO[piattaforma];
    if (skip && skip.test(u.pathname)) return "";
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length === 0) return "";
    let primo = seg[0];
    if (piattaforma === "tiktok" && primo.startsWith("@")) primo = primo.slice(1);
    if (piattaforma === "facebook" && primo === "profile.php") return "";
    if (piattaforma === "youtube" && (primo === "c" || primo === "user" || primo === "channel")) {
      return seg[1] ?? "";
    }
    if (piattaforma === "linkedin" && (primo === "company" || primo === "in")) return seg[1] ?? "";
    return primo.replace(/^@/, "");
  } catch {
    return "";
  }
}

/** Un URL che punta a un profilo e non a un contenuto? */
export function eUrlDiProfilo(url: string): boolean {
  const p = piattaformaDi(url);
  if (p === "altro" || p === "website") return false;
  return usernameDa(url).length > 0;
}

/** Normalizza l'URL di un profilo: via query, fragment, slash finale e
 *  `www`, cosi due link alla stessa pagina non diventano due candidati. */
export function normalizzaUrlProfilo(url: string): string {
  try {
    const u = new URL(url);
    u.search = ""; u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url;
  }
}

export interface ContestoIdentita {
  /** Nome dell'attivita secondo Places o il lead. */
  nome: string;
  citta: string;
  indirizzo: string;
  telefono: string;
  place_id: string;
  maps_url: string;
  /** Host del sito riconosciuto ufficiale, senza `www`. */
  official_host: string;
  /** Username che il SITO UFFICIALE dichiara, per piattaforma. Un sito
   *  che linka @tizio sta dichiarando che @tizio e suo. */
  username_dichiarati: Record<string, string[]>;
}

export interface OsservazioneProfilo {
  url: string;
  /** Da dove e saltato fuori. */
  discovered_via: SourceType;
  /** Testo leggibile del profilo, quando si e potuto leggere. */
  testo?: string;
  /** Link che il profilo espone (bio, sito). */
  link_esterni?: string[];
  /** Telefono dichiarato dal profilo. */
  telefono?: string;
  /** true = non si e potuto guardare: serve un browser vero. */
  browser_required?: boolean;
}

const PESO: Record<IdentitySignal, number> = {
  same_domain: 35,
  reciprocal_link: 35,
  declared_username: 40,
  same_phone: 35,
  same_place_id: 35,
  same_address: 25,
  // Deboli. Il totale di tutti e tre non arriva alla soglia di `verified`.
  similar_name: 12,
  same_city: 8,
  same_category: 5,
};

function eForte(s: IdentitySignal): boolean {
  return (SEGNALI_FORTI as readonly string[]).includes(s);
}

/**
 * Valuta un profilo contro quello che si sa dell'attivita.
 *
 * Nessun accesso alla rete: prende osservazioni gia raccolte e decide.
 * Cosi si testa senza uscire dal processo, ed e testabile proprio il
 * pezzo in cui un errore produce un dossier plausibile e falso.
 */
export function valutaProfilo(
  osservazione: OsservazioneProfilo,
  ctx: ContestoIdentita,
): IdentityCandidate {
  const url = normalizzaUrlProfilo(osservazione.url);
  const platform = piattaformaDi(url);
  const positivi: IdentitySignal[] = [];
  const contrari: string[] = [];

  const username = usernameDa(url);

  // --- forti ---

  // Il sito ufficiale dichiara questo username su questa piattaforma.
  const dichiarati = (ctx.username_dichiarati[platform] ?? []).map((u) => u.toLowerCase());
  if (username && dichiarati.includes(username.toLowerCase())) {
    positivi.push("declared_username");
  }

  // Il profilo linka il dominio ufficiale.
  const link = (osservazione.link_esterni ?? []).map((l) => {
    try { return new URL(l).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
  }).filter(Boolean);
  if (ctx.official_host && link.includes(ctx.official_host)) {
    positivi.push("same_domain");
    // Il sito lo dichiara E il profilo linka il sito: si linkano a
    // vicenda, ed e il segnale piu forte che esista senza login.
    if (positivi.includes("declared_username")) positivi.push("reciprocal_link");
  }

  if (osservazione.telefono && ctx.telefono) {
    if (stessoTelefono(osservazione.telefono, ctx.telefono)) positivi.push("same_phone");
    else contrari.push(`telefono dichiarato dal profilo diverso da quello dell'attivita`);
  }

  const testo = (osservazione.testo ?? "").toLowerCase();
  if (testo) {
    if (ctx.place_id && testo.includes(ctx.place_id.toLowerCase())) positivi.push("same_place_id");
    else if (ctx.maps_url && testo.includes(ctx.maps_url.toLowerCase())) positivi.push("same_place_id");
    if (ctx.indirizzo && normalizzaNome(testo).includes(normalizzaNome(ctx.indirizzo))) {
      positivi.push("same_address");
    }
  }

  // --- deboli ---
  const nomeNorm = normalizzaNome(ctx.nome);
  if (nomeNorm) {
    const dentroUrl = normalizzaNome(username).replace(/\s+/g, "");
    const compatto = nomeNorm.replace(/\s+/g, "");
    if (dentroUrl && (dentroUrl.includes(compatto) || compatto.includes(dentroUrl))) {
      positivi.push("similar_name");
    } else if (testo && normalizzaNome(testo).includes(nomeNorm)) {
      positivi.push("similar_name");
    }
  }
  if (ctx.citta && testo && normalizzaNome(testo).includes(normalizzaNome(ctx.citta))) {
    positivi.push("same_city");
  }

  const forti = positivi.filter(eForte);
  const confidence = Math.min(100, positivi.reduce((s, p) => s + PESO[p], 0));

  let status: IdentityStatus;
  let rationale: string;

  if (osservazione.browser_required) {
    // Non si e potuto guardare. Questo NON e «non esiste».
    status = "browser_required";
    rationale = "profilo non leggibile senza un browser vero: nessun giudizio espresso, non e un profilo scartato";
  } else if (contrari.length > 0 && forti.length === 0) {
    status = "rejected";
    rationale = `segnali contrari e nessun segnale forte: ${contrari.join("; ")}`;
  } else if (forti.length >= 2) {
    status = "confirmed";
    rationale = `due segnali forti concordi: ${forti.join(", ")}`;
  } else if (forti.length === 1) {
    status = "likely";
    rationale = `un solo segnale forte (${forti[0]}): serve una seconda conferma per dirlo ufficiale`;
  } else if (positivi.length > 0) {
    // Solo deboli. Qui sta la regola: non basta.
    status = "unverified_candidate";
    rationale = `solo segnali deboli (${positivi.join(", ")}): nome simile e stessa citta non bastano a dire che il profilo e suo`;
  } else {
    status = "unverified_candidate";
    rationale = "nessun segnale, in nessuna direzione";
  }

  return {
    candidate_url: url,
    platform,
    confidence,
    positive_signals: positivi,
    negative_signals: contrari,
    status,
    rationale,
    discovered_via: osservazione.discovered_via,
  };
}

/** Un link trovato sul sito ufficiale parte gia con un segnale forte:
 *  e il sito stesso a dichiararlo suo. Questo e il motivo per cui la
 *  scoperta parte SEMPRE dal sito, e la ricerca e l'ultima spiaggia. */
export function contestoConDichiarazioni(
  ctx: Omit<ContestoIdentita, "username_dichiarati">,
  linkSulSito: string[],
): ContestoIdentita {
  const dichiarati: Record<string, string[]> = {};
  for (const l of linkSulSito) {
    if (!eUrlDiProfilo(l)) continue;
    const p = piattaformaDi(l);
    const u = usernameDa(l);
    if (!u) continue;
    (dichiarati[p] ??= []).push(u);
  }
  return { ...ctx, username_dichiarati: dichiarati };
}

/** Unione senza duplicati. Il target di compilazione non consente di
 *  iterare un Set, quindi si fa a mano invece di alzare il target per
 *  tutto il progetto. */
function unici<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (const x of a.concat(b)) if (out.indexOf(x) === -1) out.push(x);
  return out;
}

/** Piu osservazioni dello stesso profilo si fondono: un profilo trovato
 *  sia sul sito sia su Places non e due candidati. */
export function unisciCandidati(candidati: IdentityCandidate[]): IdentityCandidate[] {
  const per = new Map<string, IdentityCandidate>();
  for (const c of candidati) {
    const chiave = normalizzaUrlProfilo(c.candidate_url);
    const esistente = per.get(chiave);
    if (!esistente) { per.set(chiave, c); continue; }
    const segnali: IdentitySignal[] = unici(esistente.positive_signals, c.positive_signals);
    const contrari: string[] = unici(esistente.negative_signals, c.negative_signals);
    const forti = segnali.filter(eForte);
    const confidence = Math.min(100, segnali.reduce((s, p) => s + PESO[p], 0));
    // Lo stato si ricalcola sull'unione: due osservazioni parziali
    // possono diventare insieme una verifica.
    let status: IdentityStatus = esistente.status;
    let rationale = esistente.rationale;
    if (esistente.status !== "browser_required" && c.status !== "browser_required") {
      if (forti.length >= 2) {
        status = "confirmed";
        rationale = `due segnali forti concordi da piu fonti: ${forti.join(", ")}`;
      } else if (forti.length === 1) {
        status = "likely";
        rationale = `un solo segnale forte (${forti[0]}) anche unendo le fonti`;
      }
    } else if (esistente.status === "browser_required" || c.status === "browser_required") {
      status = forti.length >= 2 ? "confirmed" : "browser_required";
      if (status === "confirmed") rationale = `verificato dai link senza bisogno di aprire il profilo: ${forti.join(", ")}`;
    }
    per.set(chiave, {
      ...esistente,
      positive_signals: segnali,
      negative_signals: contrari,
      confidence,
      status,
      rationale,
    });
  }
  const out: IdentityCandidate[] = [];
  per.forEach((v) => out.push(v));
  return out.sort((a, b) => b.confidence - a.confidence);
}
