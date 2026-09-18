import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";
import { guardiaRichiesta } from "@/lib/guardia-richiesta";
import { turso } from "@/lib/turso";
import { leggiDossier } from "@/lib/collector/db";
import { getProject } from "@/lib/factory/db";
import { rimedioBlocco, usoConsentito } from "@/lib/collector/brand";
import { fotoMostrabili } from "@/lib/demo/foto";
import {
  MIN_IN_PAGINA, selectionBasisRevision, validaProposta, validaScelteInviate,
  valutaProposta, type SceltaFoto,
} from "@/lib/demo/curatela";
import { messaggioValidazione } from "@/lib/demo/messaggi";
import {
  approvaSeAncoraValida, leggiProposta, leggiPubblicata, nuovaRevisioneProposta,
  rifiutaProposta, salvaPubblicata,
} from "@/lib/demo/proposte-db";
import { componiSpec, risolviSpec, type SpecPubblicata } from "@/lib/demo/pubblicazione";
import {
  EVENTO_APPROVAZIONE, digest, httpApprovazione, riepilogoVuoto, scriviRiepilogo,
  type EsitoApprovazione,
} from "@/lib/demo/telemetria-proposta";
import type { BrandOverall, MotivoBlocco } from "@/types/dossier";
import type { ApiResponse } from "@/types";

// ============================================================
// L'approvazione, e la ricostruzione che ne segue.
//
// TRE COSE CHE QUESTA ROTTA NON FA, E CHE SONO IL PUNTO.
//
//  1. NON APPROVA SU UNA BASE CHE NON ESISTE PIU. Il controllo sta nel
//     `where` della UPDATE. Fra il momento in cui l'operatore ha
//     guardato la proposta e il momento in cui preme «approva» ci puo
//     stare una raccolta che cambia il manifest: una lettura seguita da
//     una scrittura la lascerebbe passare.
//
//  2. NON PUBBLICA QUANDO IL MARCHIO NON E RISOLTO. `NOT_FOUND` non e
//     un ostacolo — un'attivita senza logo e il caso normale, e il nome
//     si compone tipograficamente. `PENDING`, `RETRY_REQUIRED` e
//     `BLOCKED` si: sono tre modi di non sapere, e pubblicare senza
//     sapere vuol dire mettere online una pagina che porta il nome del
//     cliente con un marchio che potrebbe non essere il suo.
//
//  3. NON TOCCA CIO CHE E ONLINE quando qualcosa va storto. La
//     pubblicazione sta in una tabella sua: se questa rotta esce da un
//     ramo di errore, la demo precedente e ancora li, intatta, perche
//     nessuno l'ha scritta.
//
// E non manda niente a nessuno: nessun outreach, nessun cambio di
// stage, nessuna notifica.
// ============================================================

export const dynamic = "force-dynamic";

export interface EsitoRisposta {
  esito: EsitoApprovazione;
  proposal_revision: string;
  pubblicata: boolean;
  /** Prima e dopo: cosa c'era online, cosa c'e adesso. */
  confronto: {
    prima: { proposal_revision: string; foto: number };
    dopo: { proposal_revision: string; foto: number };
  };
  avviso: string;
}

export async function GET() {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: "metodo GET non ammesso: questa rotta pubblica una pagina" },
    { status: 405 },
  );
}

export async function POST(req: Request) {
  const g = guardiaRichiesta(req);
  if (!g.ok) {
    return NextResponse.json<ApiResponse<never>>({ success: false, error: g.error }, { status: g.status });
  }
  // Pubblicare e una decisione, e le decisioni le prende una persona.
  if (isCronAuthorized(req)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "la pubblicazione si approva da una sessione operatore, non dal cron" },
      { status: 401 },
    );
  }
  const sessione = await getServerSession(authOptions).catch(() => null);
  if (!sessione) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "non autorizzato" }, { status: 401 },
    );
  }
  if (!turso) {
    return esci("database_non_disponibile", "Database non disponibile.");
  }

  const raw = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const projectId = typeof raw.project_id === "string" ? raw.project_id.trim() : "";
  const basisAttesa = typeof raw.basis_revision === "string" ? raw.basis_revision : "";
  const azione = raw.azione === "rifiuta" ? "rifiuta" : "approva";

  if (!projectId) return esci("input_non_valido", "serve project_id");

  const progetto = await getProject(projectId);
  if (!progetto) return esci("input_non_valido", "anteprima inesistente");

  const proposta = await leggiProposta(projectId);
  if (!proposta || proposta.curatela.scelte.length === 0) {
    return esci("stale", "Non c'è una proposta da approvare: esegui l'analisi.", progetto.lead_id, projectId);
  }

  // ----- Rifiuto: si registra, non si pubblica, e cio che e online
  //       resta online.
  if (azione === "rifiuta") {
    const ok = await rifiutaProposta(projectId, basisAttesa);
    if (!ok) {
      return esci("concorrenza", "La proposta è cambiata mentre la guardavi: ricaricala.", progetto.lead_id, projectId);
    }
    const spec = await leggiPubblicata(projectId);
    return rispondi("rifiutata", {
      esito: "rifiutata",
      proposal_revision: "",
      pubblicata: false,
      confronto: {
        prima: { proposal_revision: spec?.proposal_revision ?? "", foto: spec?.foto.length ?? 0 },
        dopo: { proposal_revision: spec?.proposal_revision ?? "", foto: spec?.foto.length ?? 0 },
      },
      avviso: "Proposta rifiutata. La demo online non è stata toccata.",
    }, progetto.lead_id, projectId, proposta.brand_status as BrandOverall);
  }

  // ----- Le scelte inviate ------------------------------------------
  const salvato = await leggiDossier(progetto.lead_id);
  const foto = salvato?.dossier ? fotoMostrabili(salvato.dossier, progetto.slug) : [];
  const lette = validaScelteInviate(raw.scelte, foto);
  if (typeof lette === "string") return esci("input_non_valido", lette, progetto.lead_id, projectId);

  // Gli stati delle fotografie NON scelte si conservano: una foto
  // guardata e scartata resta scartata, e una che serve a una persona
  // resta li ad aspettarla. Riscriverle tutte a `unreviewed` farebbe
  // ricomparire come «da guardare» roba gia guardata.
  const scelte: SceltaFoto[] = lette.map((s) => ({ ...s, stato: "selected" as const }));
  const scelti = new Set(scelte.map((s) => s.candidate_id));
  for (const s of proposta.curatela.scelte) {
    if (scelti.has(s.candidate_id)) continue;
    scelte.push({ ...s, stato: s.stato === "selected" ? "not_selected" : s.stato });
  }

  const curatela = { ...proposta.curatela, scelte };

  // LA PROPOSTA E UTILIZZABILE? Il controllo sta QUI e non solo nella
  // UI: un pulsante spento e una cortesia, non una regola. La stessa
  // funzione decide in tutti e tre i posti.
  const completezza = valutaProposta(scelte);
  if (completezza.proposal_status === "incomplete") {
    return esci(
      "proposta_incompleta",
      completezza.codice === "no_usable_media_selected"
        ? "L'analisi non ha selezionato fotografie: non c'è niente da pubblicare."
        : `Servono almeno ${MIN_IN_PAGINA} fotografie in pagina: adesso sono ${completezza.selezionate}.`,
      progetto.lead_id, projectId,
    );
  }

  const v = validaProposta(curatela, foto);
  if (v.stato !== "valida") {
    const m = messaggioValidazione(v, curatela);
    return esci("stale", m.testo, progetto.lead_id, projectId);
  }

  // ----- Il cancello del marchio ------------------------------------
  const brand = (proposta.brand_status || "PENDING") as BrandOverall;
  const uso = usoConsentito({
    primary_logo: null, alternate_logo: null, favicon: null,
    signage_reference: null, palette_candidates: [], brand_status: brand,
    requires_operator_approval: false, candidates: [],
  });
  if (brand === "BLOCKED") {
    const blocco = (proposta.brand_blocco || "") as MotivoBlocco;
    return esci(
      "marchio_bloccato",
      rimedioBlocco(blocco) || "Una capacità necessaria non è disponibile: serve un intervento sulla configurazione.",
      progetto.lead_id, projectId, brand, blocco,
    );
  }
  if (brand === "PENDING" || brand === "RETRY_REQUIRED") {
    return esci("marchio_non_risolto", uso.nota, progetto.lead_id, projectId, brand);
  }
  // `NOT_FOUND` passa: il nome si compone tipograficamente, e non lo si
  // chiama logo. Gli stati che chiedono una persona — ORIGINAL_PROBABLE,
  // SIGNAGE_ONLY, INCONCLUSIVE — passano solo senza mettere il marchio
  // in pagina, e `uso_marchio` lo registra nella spec.

  // ----- L'approvazione, atomica ------------------------------------
  const basisNuova = selectionBasisRevision(scelte, foto);
  const revisione = nuovaRevisioneProposta();
  const ok = await approvaSeAncoraValida(projectId, {
    basis_attesa: basisAttesa,
    scelte,
    basis_nuova: basisNuova,
    proposal_revision: revisione,
  });
  if (!ok) {
    return esci(
      "concorrenza",
      "La proposta è cambiata mentre la guardavi: ricaricala e riapprova.",
      progetto.lead_id, projectId, brand,
    );
  }

  // ----- La ricostruzione -------------------------------------------
  const prima = await leggiPubblicata(projectId);
  const spec: SpecPubblicata = componiSpec(
    { ...curatela, basis_revision: basisNuova, proposal_revision: revisione },
    uso.usa, brand,
  );
  await salvaPubblicata(projectId, progetto.lead_id, spec);

  const risolta = risolviSpec(spec, foto);
  return rispondi("approvata", {
    esito: "approvata",
    proposal_revision: revisione,
    pubblicata: true,
    confronto: {
      prima: { proposal_revision: prima?.proposal_revision ?? "", foto: prima?.foto.length ?? 0 },
      dopo: { proposal_revision: revisione, foto: spec.foto.length },
    },
    avviso: uso.usa === "tipografia" && brand === "NOT_FOUND"
      ? "Nessun marchio originale trovato: il nome è composto tipograficamente, e non è un logo."
      : "",
  }, progetto.lead_id, projectId, brand, "", spec, risolta.mancanti.length);
}

// ----- Risposte e telemetria ------------------------------------------

function esci(
  esito: EsitoApprovazione,
  messaggio: string,
  leadId = "",
  projectId = "",
  brand: BrandOverall | "" = "",
  blocco: MotivoBlocco = "",
) {
  const http = httpApprovazione(esito);
  scriviRiepilogo({
    ...riepilogoVuoto(EVENTO_APPROVAZIONE, projectId, leadId),
    status: esito, http, blocco, brand_status: brand,
  });
  return NextResponse.json<ApiResponse<never>>({ success: false, error: messaggio }, { status: http });
}

function rispondi(
  esito: EsitoApprovazione,
  data: EsitoRisposta,
  leadId: string,
  projectId: string,
  brand: BrandOverall | "" = "",
  blocco: MotivoBlocco = "",
  spec?: SpecPubblicata,
  mancanti = 0,
) {
  scriviRiepilogo({
    ...riepilogoVuoto(EVENTO_APPROVAZIONE, projectId, leadId),
    status: esito,
    http: httpApprovazione(esito),
    blocco,
    brand_status: brand,
    basis_digest: digest(spec?.basis_revision ?? ""),
    proposal_revision: data.proposal_revision,
    foto_selezionate: spec?.foto.length ?? 0,
    foto_mancanti: mancanti,
    pubblicata: data.pubblicata,
  });
  return NextResponse.json<ApiResponse<EsitoRisposta>>({ success: true, data });
}
