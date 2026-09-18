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
  BusinessDossier, CommercialRecommendation, ContentReadiness, ContiMedia,
  IdentityCandidate, IdentityStatus, MediaCandidate, MediaReadiness,
  SocialReadiness,
} from "@/types/dossier";
import { CONSERVAZIONE_PER_DIRITTO, VISUALIZZAZIONE_PER_DIRITTO } from "./media";

export interface Decisioni {
  commercial_recommendation: CommercialRecommendation;
  content_readiness: ContentReadiness;
  media_readiness: MediaReadiness;
  social_readiness: SocialReadiness;
  reasons: {
    commercial: string[]; content: string[]; media: string[]; social: string[];
  };
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
 * Quali profili possono finire NEL SITO.
 *
 * Uno solo: `confirmed`. Tutti gli altri restano nel dossier, dove
 * servono a una persona che guarda, e non escono da li.
 *
 * Questa e la regola da cui discende tutto il resto. Finche e questa a
 * decidere cosa si pubblica, nessuno stato di un profilo puo fare
 * danno — e quindi nessuno deve poter declassare un lead sano.
 *
 * L'errore che ho commesso e che questa funzione esiste per impedire:
 * avevo messo `browser_required` fra i motivi di REVIEW commerciale,
 * ragionando che un profilo trovato da una ricerca e non leggibile
 * potrebbe essere di un altro. Vero, ma irrilevante: non sarebbe mai
 * finito nel sito comunque. L'effetto pratico e stato che accendere la
 * ricerca social ha peggiorato la valutazione commerciale della stessa
 * identica attivita — 16 fatti verificati, zero conflitti, nessun sito
 * — solo perche avevamo guardato di piu. Cercare di piu non puo
 * rendere un lead peggiore.
 */
export function profiliUtilizzabili(
  identities: readonly IdentityCandidate[],
): IdentityCandidate[] {
  return identities.filter((i) => i.status === "confirmed").slice();
}

/** I conteggi per stato, che finiscono in telemetria e nel pannello. */
export function contiSocial(identities: readonly IdentityCandidate[]) {
  const per = (st: IdentityStatus) => identities.filter((i) => i.status === st).length;
  return {
    confirmed: per("confirmed"),
    likely: per("likely"),
    unverified_candidate: per("unverified_candidate"),
    browser_required: per("browser_required"),
    rejected: per("rejected"),
  };
}

/**
 * Rimette in forma un dossier letto dall'archivio, e RICALCOLA le
 * decisioni dai fatti che porta con se.
 *
 * Avevo scritto il contrario — «una decisione ricalcolata a distanza non
 * e la stessa decisione» — e per i dossier precedenti alla separazione
 * era vero, perche i dati su cui erano state prese non c'erano piu
 * tutti. Ma il dossier E il registro completo: identita, conflitti,
 * place_id, stato operativo, punteggio del sito, media. Applicare la
 * regola corrente a dati completi non e tirare a indovinare, e
 * esattamente quello che la regola serve a fare.
 *
 * E ha una conseguenza pratica che vale il cambio: quando la regola si
 * corregge, la correzione raggiunge cio che e gia in archivio senza
 * ripagare una sola chiamata esterna. Nessuna rete, nessun modello:
 * `decidi` e una funzione pura.
 *
 * Quello che invece NON si ricalcola sono i fatti: verificati,
 * conflitti, profili e fotografie restano quelli osservati allora.
 */
export function conDecisioniColmate(d: BusinessDossier): BusinessDossier {
  if (!d || !d.media) return d;

  // Un candidato vecchio non ha `display_status`: quei due campi si
  // derivano dai diritti, che invece ci sono sempre. Senza, ogni
  // fotografia gia in archivio risulterebbe non mostrabile.
  const candidati = (d.media.candidates ?? []).map((m) => m.display_status ? m : {
    ...m,
    display_status: VISUALIZZAZIONE_PER_DIRITTO[m.rights_status] ?? "display_forbidden",
    storage_status: CONSERVAZIONE_PER_DIRITTO[m.rights_status] ?? "do_not_store",
  });
  const approvate = d.media.approved_ids ?? [];
  const conta = (f: (m: MediaCandidate) => boolean) => candidati.filter(f).length;
  const counts: ContiMedia = {
    totali: candidati.length,
    tramite_provider: conta((m) => m.rights_status === "provider_rendered"),
    proprietarie: conta((m) => m.rights_status === "customer_owned"),
    copiabili: conta((m) => m.storage_status === "store_allowed"),
    utilizzabili_in_demo: conta((m) =>
      m.display_status === "display_allowed"
      || m.display_status === "display_allowed_with_attribution"
      || approvate.indexOf(m.id) !== -1),
    da_approvare: conta((m) =>
      m.display_status === "display_after_approval" && approvate.indexOf(m.id) === -1),
  };

  const normalizzato: BusinessDossier = {
    ...d,
    verified: d.verified ?? [],
    probable: d.probable ?? [],
    conflicts: d.conflicts ?? [],
    missing: d.missing ?? [],
    identities: d.identities ?? [],
    media: { ...d.media, candidates: candidati, counts },
    // `null` significa «non misurato», e non deve poter valere zero.
    website_opportunity_score: d.website_opportunity_score ?? null,
  };

  const nuove = decidi(normalizzato);
  return {
    ...normalizzato,
    commercial_recommendation: nuove.commercial_recommendation,
    content_readiness: nuove.content_readiness,
    media_readiness: nuove.media_readiness,
    social_readiness: nuove.social_readiness,
    decision_reasons: nuove.reasons,
    // Il campo storico resta allineato alla decisione commerciale.
    recommendation: nuove.commercial_recommendation,
    recommendation_reasons: nuove.reasons.commercial
      .concat(nuove.reasons.content, nuove.reasons.media, nuove.reasons.social),
  };
}

export function decidi(d: BusinessDossier): Decisioni {
  const commercial: string[] = [];
  const content: string[] = [];
  const media: string[] = [];
  const social: string[] = [];

  // ----- 1. Decisione commerciale ---------------------------------

  const stato = statoAttivita(d);
  const chiusa = /CLOSED/i.test(stato);
  const bloccanti = d.conflicts.filter((c) => c.blocking);
  const ancorata = identitaSicura(d);
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
  } else if (!stato) {
    // Stato operativo non determinabile: non si sa se sia ancora aperta.
    commerciale = "REVIEW";
    commercial.push("Stato operativo non determinabile: Places non dichiara se l'attivita sia ancora aperta.");
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

  // I social NON compaiono qui, di proposito. La decisione commerciale
  // risponde a «e la stessa attivita, ed e un'opportunita»: un profilo
  // Instagram che non si apre non tocca nessuna delle due cose.
  // Risponde `social_readiness`, piu sotto.

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

  // ----- 4. Social --------------------------------------------------
  //
  // Una risposta a se', che non tocca nessuna delle altre tre. Dice
  // quanto materiale social e UTILIZZABILE, sapendo che utilizzabile
  // vuol dire una cosa sola: `confirmed`.

  const c = contiSocial(d.identities ?? []);
  const nonUsabili = c.likely + c.unverified_candidate + c.browser_required;

  let socialStato: SocialReadiness;
  if (c.confirmed > 0) {
    socialStato = "CONFIRMED";
    social.push(`${c.confirmed} profili verificati: sono gli unici che possono entrare nel sito.`);
  } else if (c.browser_required > 0 && c.likely + c.unverified_candidate === 0) {
    socialStato = "BROWSER_REQUIRED";
    social.push(`${c.browser_required} profili trovati ma non leggibili: la piattaforma pretende un accesso. Non e «non esistono», e «non li abbiamo potuti guardare».`);
  } else if (nonUsabili > 0) {
    socialStato = "CANDIDATES";
    social.push(`${nonUsabili} profili candidati, nessuno verificato: restano nel dossier e non entrano nel sito.`);
    if (c.browser_required > 0) social.push(`${c.browser_required} di questi non si sono potuti leggere.`);
  } else {
    socialStato = "NONE";
    social.push("Nessun profilo social trovato.");
  }
  if (c.rejected > 0) social.push(`${c.rejected} scartati: i segnali dicevano di un'altra attivita.`);

  return {
    commercial_recommendation: commerciale,
    content_readiness: contenuto,
    media_readiness: mediaStato,
    social_readiness: socialStato,
    reasons: { commercial, content, media, social },
  };
}
