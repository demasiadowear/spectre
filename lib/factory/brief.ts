import type {
  BusinessDossier, DossierFact, MediaCandidate,
} from "@/types/dossier";

// ============================================================
// Dal BusinessDossier al brief creativo, e alla matrice di cosa e
// stato usato e cosa no.
//
// PERCHE ESISTE, invece di lasciar leggere il dossier a chi progetta.
//
// «Nessun fatto inventato» e una regola che, affidata alla disciplina,
// si rompe nel punto piu naturale del mestiere: mentre si scrive il
// copy. Nessuno inventa un indirizzo — ma «da trent'anni nel cuore
// della citta» si scrive senza accorgersene, e sembra vero perche
// suona vero.
//
// Quindi il brief non e un riassunto del dossier scritto da qualcuno:
// e una PROIEZIONE, calcolata. Cio che non e nel dossier non puo
// entrare nel brief, perche non c'e una riga di codice che possa
// metterlo li. E cio che il dossier ha ma non si puo usare esce
// dichiarato, con il motivo, invece di sparire in silenzio: una lacuna
// che si vede e una lacuna che non si riempie di fantasia.
//
// Le tre esclusioni che contano, e da dove vengono:
//
//  - un fatto CONTESO non si usa. Se Places dice un telefono e il sito
//    ne dice un altro, il dossier li tiene entrambi e dichiara il
//    conflitto; metterne uno sul sito significa sceglierne uno a caso
//    e stamparlo sotto il nome del cliente.
//  - un profilo social entra SOLO se `confirmed`. E la stessa regola
//    del collector, applicata al punto in cui farebbe danno.
//  - una fotografia entra solo se e mostrabile ADESSO: nostra, gia
//    approvata, o resa dal provider con la sua attribuzione.
// ============================================================

/** Quello che serve a chi progetta, e nient'altro. */
export interface Brief {
  lead_id: string;
  /** Il nome, l'unico campo senza il quale non si costruisce niente. */
  nome: string;
  categoria: string;
  /** Dove sta, come si raggiunge: solo quello verificato e non conteso. */
  luogo: { indirizzo: string; citta: string; maps_url: string };
  /** Recapiti utilizzabili in una CTA. Se e vuoto, le CTA vanno alla
   *  scheda Maps: non si inventa un modulo di contatto che scrive a un
   *  indirizzo che non esiste. */
  contatti: { telefono: string; email: string };
  orari: string[];
  servizi: string[];
  descrizione: string;
  /** Profili pubblicabili. Solo `confirmed`, spesso zero. */
  social: { url: string; platform: string }[];
  /** Fotografie mostrabili subito, con l'attribuzione che le accompagna. */
  fotografie: {
    id: string;
    /** Riferimento del provider, per il rendering on demand. */
    provider_reference: string;
    source_url: string;
    attribuzione: string;
    /** true = va mostrata citando la fonte. */
    attribuzione_obbligatoria: boolean;
    ruolo: string;
    larghezza: number;
    altezza: number;
  }[];
  /** Le tre decisioni del dossier, cosi chi progetta sa cosa ha in mano. */
  stato: {
    commerciale: string;
    contenuto: string;
    media: string;
    social: string;
    opportunita_sito: number | null;
  };
  /** Cio che NON c'e. Si scrive nel brief perche una lacuna dichiarata
   *  non si riempie per distrazione. */
  lacune: string[];
}

export type MotivoEsclusione =
  | "conteso"               // due fonti in disaccordo: decide una persona
  | "non_verificato"        // sotto la soglia per finire su una pagina
  | "non_confermato"        // profilo social senza due segnali forti
  | "non_mostrabile"        // fotografia senza diritto di visualizzazione
  | "non_trovato"           // cercato e non trovato
  | "solo_interno";         // sta nel pannello, mai in pagina

export interface VoceMatrice {
  campo: string;
  usato: boolean;
  valore: string;
  fonte: string;
  motivo: MotivoEsclusione | "";
}

export interface MatriceFatti {
  usati: VoceMatrice[];
  esclusi: VoceMatrice[];
}

/** Campi che il sito non pubblica mai, per quanto verificati siano.
 *  `social` sta qui perche il suo posto e la sezione social, non un
 *  fatto in pagina; `business_status` e un dato di lavorazione. */
const MAI_IN_PAGINA = ["social", "images", "business_status", "website"];

/** Un fatto conteso porta il suo campo nell'elenco dei conflitti. */
function campiContesi(d: BusinessDossier): string[] {
  return (d.conflicts ?? []).map((c) => c.field);
}

/** Il valore di un campo, se c'e, se e verificato e se nessuno lo
 *  contesta. `probable` non basta per finire su una pagina pubblica:
 *  la differenza fra «probabilmente» e «e cosi» la paga il cliente. */
function valore(d: BusinessDossier, campo: string): string {
  if (campiContesi(d).indexOf(campo) !== -1) return "";
  const f = (d.verified ?? []).find((x) => x.field === campo);
  return f?.value ?? "";
}

function valori(d: BusinessDossier, campo: string): string[] {
  if (campiContesi(d).indexOf(campo) !== -1) return [];
  return (d.verified ?? []).filter((x) => x.field === campo).map((x) => x.value);
}

/** Una fotografia si puo mostrare ADESSO? */
export function mostrabileSubito(m: MediaCandidate, approvate: readonly string[]): boolean {
  return m.display_status === "display_allowed"
    || m.display_status === "display_allowed_with_attribution"
    || approvate.indexOf(m.id) !== -1;
}

export function briefDaDossier(d: BusinessDossier): Brief {
  const approvate = d.media?.approved_ids ?? [];

  const fotografie = (d.media?.candidates ?? [])
    .filter((m) => mostrabileSubito(m, approvate))
    .map((m) => ({
      id: m.id,
      provider_reference: m.provider_reference,
      source_url: m.source_url,
      attribuzione: m.attribution,
      attribuzione_obbligatoria: m.display_status === "display_allowed_with_attribution",
      ruolo: m.probable_role,
      larghezza: m.width,
      altezza: m.height,
    }));

  // Solo `confirmed`. E la stessa regola del collector, applicata al
  // punto in cui farebbe danno: qui il profilo finirebbe in pagina.
  const social = (d.identities ?? [])
    .filter((i) => i.status === "confirmed")
    .map((i) => ({ url: i.candidate_url, platform: i.platform }));

  const telefono = valore(d, "phone");
  const email = valore(d, "email");

  const lacune: string[] = [];
  const manca = (cosa: string) => lacune.push(cosa);
  if (!valore(d, "category")) manca("categoria dell'attivita");
  if (valori(d, "hours").length === 0) manca("orari di apertura");
  if (valori(d, "services").length === 0) manca("elenco dei servizi");
  if (!valore(d, "description")) manca("descrizione dell'attivita");
  if (!telefono && !email) manca("qualunque recapito diretto: le CTA devono puntare alla scheda Maps");
  if (social.length === 0) manca("profili social verificati: nessun collegamento social in pagina");
  if (fotografie.length === 0) manca("fotografie utilizzabili");
  for (const c of d.conflicts ?? []) {
    manca(`${c.field}: due fonti in disaccordo, non si pubblica finche non lo decide una persona`);
  }

  return {
    lead_id: d.lead_id,
    nome: valore(d, "name"),
    categoria: valore(d, "category"),
    luogo: {
      indirizzo: valore(d, "address"),
      citta: valore(d, "city"),
      maps_url: valore(d, "maps_url"),
    },
    contatti: { telefono, email },
    orari: valori(d, "hours"),
    servizi: valori(d, "services"),
    descrizione: valore(d, "description"),
    social,
    fotografie,
    stato: {
      commerciale: d.commercial_recommendation ?? "",
      contenuto: d.content_readiness ?? "",
      media: d.media_readiness ?? "",
      social: d.social_readiness ?? "",
      opportunita_sito: d.website_opportunity_score ?? null,
    },
    lacune,
  };
}

/**
 * La matrice: ogni fatto del dossier, usato o escluso, col motivo.
 *
 * Serve a rispondere a una domanda sola, che di solito non si puo
 * rispondere guardando un sito finito: da dove viene questa riga? E,
 * altrettanto importante, perche QUESTA cosa che il dossier aveva non
 * e finita in pagina.
 */
export function matriceFatti(d: BusinessDossier): MatriceFatti {
  const usati: VoceMatrice[] = [];
  const esclusi: VoceMatrice[] = [];
  const contesi = campiContesi(d);

  const voce = (f: DossierFact): VoceMatrice => ({
    campo: f.field, usato: false, valore: f.value,
    fonte: f.source_type, motivo: "",
  });

  for (const f of d.verified ?? []) {
    const v = voce(f);
    if (MAI_IN_PAGINA.indexOf(f.field) !== -1) {
      esclusi.push({ ...v, motivo: "solo_interno" });
    } else if (contesi.indexOf(f.field) !== -1) {
      esclusi.push({ ...v, motivo: "conteso" });
    } else if (f.usage_scope === "internal_review" || f.usage_scope === "blocked") {
      esclusi.push({ ...v, motivo: "solo_interno" });
    } else {
      usati.push({ ...v, usato: true });
    }
  }

  // I `probable` non entrano: sotto la soglia per una pagina pubblica.
  for (const f of d.probable ?? []) {
    esclusi.push({ ...voce(f), motivo: contesi.indexOf(f.field) !== -1 ? "conteso" : "non_verificato" });
  }

  for (const campo of d.missing ?? []) {
    esclusi.push({ campo, usato: false, valore: "", fonte: "", motivo: "non_trovato" });
  }

  for (const i of d.identities ?? []) {
    const usato = i.status === "confirmed";
    const v: VoceMatrice = {
      campo: `social:${i.platform}`, usato, valore: i.candidate_url,
      fonte: i.discovered_via, motivo: usato ? "" : "non_confermato",
    };
    (usato ? usati : esclusi).push(v);
  }

  const approvate = d.media?.approved_ids ?? [];
  for (const m of d.media?.candidates ?? []) {
    const usato = mostrabileSubito(m, approvate);
    const v: VoceMatrice = {
      campo: `media:${m.probable_role}`, usato,
      valore: m.provider_reference || m.source_url,
      fonte: m.rights_status, motivo: usato ? "" : "non_mostrabile",
    };
    (usato ? usati : esclusi).push(v);
  }

  return { usati, esclusi };
}

/** Il brief in una forma leggibile da una persona. Nessun dato nuovo:
 *  solo la stessa proiezione, impaginata. */
export function briefLeggibile(b: Brief): string {
  const r: string[] = [];
  const riga = (k: string, v: string) => { if (v) r.push(`${k}: ${v}`); };

  r.push(`# Brief — ${b.nome || "(nome assente)"}`);
  r.push("");
  r.push(`Generato dal BusinessDossier ${b.lead_id}. Tutto quello che c'e qui`);
  r.push("viene da li. Quello che non c'e, non c'e nel dossier.");
  r.push("");
  r.push("## Identita");
  riga("Nome", b.nome);
  riga("Categoria", b.categoria || "(non nel dossier)");
  riga("Indirizzo", b.luogo.indirizzo);
  riga("Scheda Google", b.luogo.maps_url);
  r.push("");
  r.push("## Recapiti utilizzabili nelle CTA");
  if (b.contatti.telefono || b.contatti.email) {
    riga("Telefono", b.contatti.telefono);
    riga("Email", b.contatti.email);
  } else {
    r.push("Nessuno. Le CTA devono puntare alla scheda Google Maps:");
    r.push("un modulo di contatto senza un indirizzo dove scrivere e finto.");
  }
  r.push("");
  r.push(`## Orari (${b.orari.length})`);
  r.push(b.orari.length ? b.orari.map((o) => `- ${o}`).join("\n") : "Non nel dossier.");
  r.push("");
  r.push(`## Servizi (${b.servizi.length})`);
  r.push(b.servizi.length ? b.servizi.map((s) => `- ${s}`).join("\n") : "Non nel dossier. Non si elencano servizi plausibili.");
  r.push("");
  r.push("## Descrizione");
  r.push(b.descrizione || "Non nel dossier. Il copy dovra reggersi su cio che e verificato.");
  r.push("");
  r.push(`## Social pubblicabili (${b.social.length})`);
  r.push(b.social.length
    ? b.social.map((s) => `- ${s.platform}: ${s.url}`).join("\n")
    : "Nessuno verificato. Nessun collegamento social va in pagina.");
  r.push("");
  r.push(`## Fotografie utilizzabili (${b.fotografie.length})`);
  for (const f of b.fotografie) {
    r.push(`- ${f.ruolo} ${f.larghezza}x${f.altezza}${
      f.attribuzione_obbligatoria ? ` — attribuzione obbligatoria: ${f.attribuzione || "Google Maps"}` : ""}`);
  }
  if (!b.fotografie.length) r.push("Nessuna.");
  r.push("");
  r.push("## Stato");
  r.push(`Commerciale ${b.stato.commerciale} · contenuto ${b.stato.contenuto}`
    + ` · media ${b.stato.media} · social ${b.stato.social}`
    + (b.stato.opportunita_sito !== null ? ` · opportunita sito ${b.stato.opportunita_sito}/100` : ""));
  r.push("");
  r.push("## Cosa manca, e che NON va inventato");
  r.push(b.lacune.length ? b.lacune.map((l) => `- ${l}`).join("\n") : "Niente.");
  return r.join("\n");
}
