// ============================================================
// Tre decisioni indipendenti su un dossier.
//
// Il difetto che questo modulo esiste per correggere si e visto sul
// primo lead reale: un'attivita identificata con sicurezza, operativa,
// con sedici fatti verificati e zero conflitti finiva in REVIEW perche
// non aveva un sito web.
//
// Ma l'assenza del sito e il MOTIVO per cui la Factory esiste. Una
// decisione sola costringeva a mescolare «vale la pena lavorarci»,
// «ho abbastanza materiale» e «posso mostrare delle fotografie», che
// sono tre domande diverse con tre risposte diverse. Un'attivita puo
// benissimo essere una GO commerciale con contenuto PARTIAL e media
// DISPLAYABLE: sono tutte e tre vere insieme.
//
// Funzione pura: prende un dossier, restituisce le tre risposte e le
// ragioni. Nessuna rete, nessun accesso al database.
// ============================================================

import type {
  BusinessDossier, CommercialRecommendation, ContentReadiness,
  MediaReadiness,
} from "@/types/dossier";

export interface Decisioni {
  commercial_recommendation: CommercialRecommendation;
  content_readiness: ContentReadiness;
  media_readiness: MediaReadiness;
  reasons: { commercial: string[]; content: string[]; media: string[] };
}

/** Sotto questo punteggio un sito esistente e gia abbastanza buono: non
 *  c'e un'opportunita commerciale da proporre. */
export const SOGLIA_OPPORTUNITA = 40;

/** Il minimo per costruire una demo che non menta: come si chiama,
 *  dove sta, come lo si raggiunge. */
const CAMPI_ESSENZIALI = ["name"];
const CAMPI_LOCALIZZAZIONE = ["address", "coordinates", "maps_url"];
const CAMPI_CONTATTO = ["phone", "email"];
/** Quello che rende una demo ricca invece che minima. */
const CAMPI_RICCHEZZA = ["category", "hours", "services", "description"];

const haCampo = (d: BusinessDossier, campo: string): boolean =>
  d.verified.some((f) => f.field === campo) || d.probable.some((f) => f.field === campo);

/** Chiusa definitivamente o temporaneamente, secondo Places. */
function statoAttivita(d: BusinessDossier): string {
  return d.verified.concat(d.probable)
    .find((f) => f.field === "business_status")?.value ?? "";
}

/**
 * L'identita e ancorata?
 *
 * Il `place_id` e l'ancora: senza, non si sa con certezza DI CHI si
 * stanno raccogliendo i dati, e tutto il resto poggia sul nulla.
 */
function identitaSicura(d: BusinessDossier): boolean {
  return Boolean(d.place_id) && haCampo(d, "name");
}

/**
 * Profili che potrebbero essere di un'ALTRA attivita.
 *
 * Sono il rischio concreto di attribuzione sbagliata, e sono l'unico
 * motivo social per cui una persona deve guardare prima.
 *
 * La distinzione che conta e COME e stato trovato il profilo, non se lo
 * si e riusciti a leggere:
 *
 *  - un profilo LINKATO dal sito ufficiale e dichiarato dall'attivita
 *    stessa. Se poi il collector non riesce ad aprirlo perche la
 *    piattaforma pretende un login, il profilo resta suo: non e un
 *    dubbio di identita, e una pagina non letta.
 *  - un profilo TROVATO da una ricerca non e dichiarato da nessuno. Se
 *    resta anche non verificato, metterlo sul sito significherebbe
 *    pubblicare l'Instagram di qualcun altro.
 */
function profiliAmbigui(d: BusinessDossier): number {
  return d.identities.filter((i) => {
    if (i.status === "unverified_candidate") return true;
    return i.status === "browser_required" && i.discovered_via === "grounded_search";
  }).length;
}

/**
 * Un dossier salvato PRIMA della separazione delle tre decisioni non ha
 * i tre campi nuovi: ha solo `recommendation`.
 *
 * Non si ricalcola la decisione — i dati su cui era stata presa non ci
 * sono piu tutti, e una decisione ricalcolata a mesi di distanza non e
 * la stessa decisione. Si riporta quello che c'era, dichiarandolo: il
 * pannello mostra una risposta vera e vecchia invece di `undefined`.
 */
export function conDecisioniColmate(d: BusinessDossier): BusinessDossier {
  if (d.commercial_recommendation) return d;
  const vecchia = d.recommendation ?? "REVIEW";
  return {
    ...d,
    commercial_recommendation: vecchia,
    content_readiness: "PARTIAL",
    media_readiness: (d.media?.candidates?.length ?? 0) > 0 ? "APPROVAL_REQUIRED" : "NONE",
    website_opportunity_score: d.website_opportunity_score ?? null,
    decision_reasons: {
      commercial: (d.recommendation_reasons ?? []).slice(),
      content: ["Dossier raccolto prima della separazione delle tre decisioni: rilancia la raccolta per una risposta aggiornata."],
      media: [],
    },
  };
}

export function decidi(d: BusinessDossier): Decisioni {
  const commercial: string[] = [];
  const content: string[] = [];
  const media: string[] = [];

  // ----- 1. Decisione commerciale ---------------------------------

  const stato = statoAttivita(d);
  const chiusa = /CLOSED/i.test(stato);
  const bloccanti = d.conflicts.filter((c) => c.blocking);
  const ancorata = identitaSicura(d);
  const ambigui = profiliAmbigui(d);
  const punteggio = d.website_opportunity_score;
  const haSito = Boolean(d.official_site);

  let commerciale: CommercialRecommendation;

  if (chiusa) {
    commerciale = "REJECT";
    commercial.push(`Google dichiara l'attivita ${stato}: non c'e niente da proporre.`);
  } else if (!ancorata) {
    commerciale = "REVIEW";
    commercial.push("Identita non ancorata: senza una corrispondenza sicura su Places non si sa di chi siano i dati raccolti.");
  } else if (bloccanti.length > 0) {
    commerciale = "REVIEW";
    commercial.push(`${bloccanti.length} conflitti su informazioni indispensabili (${bloccanti.map((c) => c.field).join(", ")}): li decide una persona.`);
  } else if (ambigui > 0) {
    commerciale = "REVIEW";
    commercial.push(`${ambigui} profili social potrebbero essere di un'altra attivita: rischio concreto di attribuzione sbagliata.`);
  } else if (haSito && punteggio !== null && punteggio < SOGLIA_OPPORTUNITA) {
    commerciale = "REJECT";
    commercial.push(`Il sito attuale funziona (opportunita ${punteggio}/100, sotto ${SOGLIA_OPPORTUNITA}): non c'e un problema da risolvere.`);
  } else {
    commerciale = "GO";
    if (!haSito) {
      // Il punto di tutta questa riscrittura.
      commercial.push("Nessun sito ufficiale: e esattamente il caso per cui la Factory esiste.");
    } else if (punteggio !== null) {
      commercial.push(`Sito presente ma con opportunita ${punteggio}/100: c'e margine per rifarlo.`);
    } else {
      commercial.push("Sito dichiarato ma non analizzabile: resta un'opportunita da valutare a vista.");
    }
    commercial.push("Identita ancorata su Places, attivita operativa, nessun conflitto bloccante.");
  }

  // ----- 2. Contenuto ---------------------------------------------

  const haEssenziali = CAMPI_ESSENZIALI.every((c) => haCampo(d, c));
  const haDove = CAMPI_LOCALIZZAZIONE.some((c) => haCampo(d, c));
  const haCome = CAMPI_CONTATTO.some((c) => haCampo(d, c));
  const ricchezza = CAMPI_RICCHEZZA.filter((c) => haCampo(d, c));

  let contenuto: ContentReadiness;
  if (!haEssenziali || (!haDove && !haCome)) {
    contenuto = "BLOCKED";
    content.push("Mancano il nome o qualunque modo di localizzare e contattare l'attivita: non si puo costruire niente di vero.");
  } else if (ricchezza.length >= CAMPI_RICCHEZZA.length - 1 && haDove && haCome) {
    contenuto = "READY";
    content.push(`Materiale sufficiente per una demo completa: ${ricchezza.join(", ")}.`);
  } else {
    contenuto = "PARTIAL";
    const mancano = CAMPI_RICCHEZZA.filter((c) => !haCampo(d, c));
    content.push(`Si puo costruire una demo, ma mancano: ${mancano.join(", ") || "nulla di essenziale"}.`);
    if (!haCome) content.push("Nessun recapito diretto: la CTA dovra puntare alla scheda Maps.");
  }
  if (d.missing.length) content.push(`Campi cercati e non trovati: ${d.missing.join(", ")}.`);

  // ----- 3. Media --------------------------------------------------

  const candidati = d.media?.candidates ?? [];
  const approvate = new Set(d.media?.approved_ids ?? []);

  // Mostrabili SUBITO: le nostre, quelle gia approvate, e quelle che il
  // provider consente di rendere citando la fonte. Quest'ultimo caso
  // era il piu frainteso: «non e nostra» non vuol dire «non si mostra».
  const mostrabili = candidati.filter((m) =>
    m.display_status === "display_allowed"
    || m.display_status === "display_allowed_with_attribution"
    || approvate.has(m.id));
  const daApprovare = candidati.filter((m) =>
    m.display_status === "display_after_approval" && !approvate.has(m.id));
  const vietate = candidati.filter((m) => m.display_status === "display_forbidden");

  let mediaStato: MediaReadiness;
  if (candidati.length === 0) {
    mediaStato = "NONE";
    media.push("Nessuna immagine candidata.");
  } else if (mostrabili.length > 0) {
    mediaStato = "DISPLAYABLE";
    const conAttribuzione = mostrabili.filter((m) => m.display_status === "display_allowed_with_attribution").length;
    media.push(`${mostrabili.length} immagini utilizzabili nella demo${conAttribuzione ? `, di cui ${conAttribuzione} con attribuzione obbligatoria` : ""}.`);
    if (daApprovare.length) media.push(`${daApprovare.length} in attesa di approvazione.`);
  } else if (daApprovare.length > 0) {
    mediaStato = "APPROVAL_REQUIRED";
    media.push(`${daApprovare.length} immagini dai canali ufficiali: utilizzabili solo nella demo privata finche non le approvi.`);
  } else {
    mediaStato = "BLOCKED";
    media.push(`${vietate.length} immagini candidate, nessuna utilizzabile: provenienza non riconducibile a un canale ufficiale.`);
  }

  return {
    commercial_recommendation: commerciale,
    content_readiness: contenuto,
    media_readiness: mediaStato,
    reasons: { commercial, content, media },
  };
}
