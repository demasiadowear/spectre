"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Ban, Camera, CheckCircle2, ExternalLink, Eye,
  HelpCircle, Loader2, RefreshCw, Search, ShieldCheck,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import type {
  BusinessDossier, CollectPhase, CommercialRecommendation, ContentReadiness,
  IdentityCandidate, MediaCandidate, MediaReadiness, PhaseState, RightsStatus,
} from "@/types/dossier";
import type { StatoRuntime } from "./PannelloStato";

// ============================================================
// «Raccogli dati e fotografie».
//
// Una schermata che deve funzionare col pollice, su un telefono, in
// piedi davanti a un locale. Quindi: una colonna sola sotto i 640px,
// bersagli grandi, e le cose che contano in alto — la raccomandazione,
// i conflitti, i dati mancanti. Le fotografie vengono dopo, perche
// sono la parte che si guarda con calma.
//
// Non genera il sito. Raccoglie, mostra, e si ferma: la generazione e
// una decisione separata che si prende guardando questo.
// ============================================================

const ETICHETTA_FASE: Record<CollectPhase, string> = {
  places: "Google Places",
  official_site: "Sito ufficiale",
  social_discovery: "Profili social",
  media: "Fotografie",
  reconcile: "Riconciliazione",
};

const ETICHETTA_DIRITTI: Record<RightsStatus, string> = {
  customer_owned: "Fornita dal cliente",
  official_public_pending_approval: "Canale ufficiale — da approvare",
  provider_rendered: "Google — solo tramite provider",
  unknown: "Provenienza ignota",
  forbidden: "Vietata",
};

const COLORE_DIRITTI: Record<RightsStatus, string> = {
  customer_owned: "text-success border-success/40",
  official_public_pending_approval: "text-ochre border-ochre/40",
  provider_rendered: "text-accent border-accent/40",
  unknown: "text-text2 border-border",
  forbidden: "text-danger border-danger/40",
};

/** Verde = si va avanti, ambra = serve una persona, rosso = ci si ferma,
 *  grigio = non c'è niente da decidere. Quattro toni, non cinque
 *  sfumature: questa schermata si legge in piedi davanti a un locale. */
type Tono = "bene" | "attesa" | "male" | "neutro";

const TONO_COMMERCIALE: Record<CommercialRecommendation, Tono> = {
  GO: "bene", REVIEW: "attesa", REJECT: "male",
};
const TONO_CONTENUTO: Record<ContentReadiness, Tono> = {
  READY: "bene", PARTIAL: "attesa", BLOCKED: "male",
};
const TONO_MEDIA: Record<MediaReadiness, Tono> = {
  DISPLAYABLE: "bene", APPROVAL_REQUIRED: "attesa", BLOCKED: "male", NONE: "neutro",
};

const BORDO: Record<Tono, string> = {
  bene: "border-success/40 bg-success/5",
  attesa: "border-ochre/40 bg-ochre/5",
  male: "border-danger/40 bg-danger/5",
  neutro: "border-border",
};
const TESTO: Record<Tono, string> = {
  bene: "text-success", attesa: "text-ochre", male: "text-danger", neutro: "text-text2",
};

const ETICHETTA_IDENTITA: Record<IdentityCandidate["status"], string> = {
  confirmed: "Confermato",
  likely: "Probabile",
  unverified_candidate: "Candidato non verificato",
  rejected: "Rifiutato",
  browser_required: "Serve un browser",
};

interface RispostaDossier {
  trovato: boolean;
  dossier: BusinessDossier | null;
  phases: PhaseState[];
  decisioni: Record<string, "approved" | "blocked">;
  external_calls: number;
  total_ms: number;
  updated_at: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = (await res.json()) as { success: boolean; data?: T; error?: string };
  if (!j.success) throw new Error(j.error ?? `errore ${res.status}`);
  return j.data as T;
}

export default function CollectorPanel({ leadId, leadName }: { leadId: string; leadName?: string }) {
  const [dati, setDati] = useState<RispostaDossier | null>(null);
  const [cap, setCap] = useState<StatoRuntime | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [faseCorrente, setFaseCorrente] = useState<CollectPhase | null>(null);
  const [errore, setErrore] = useState("");
  const [espandi, setEspandi] = useState<"fatti" | "media" | "profili" | "fonti" | null>(null);

  const carica = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([
        api<RispostaDossier>(`/api/collector/dossier?lead_id=${encodeURIComponent(leadId)}`),
        api<StatoRuntime>("/api/collector/capability"),
      ]);
      setDati(d);
      setCap(c);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, [leadId]);

  useEffect(() => { void carica(); }, [carica]);

  const avvia = useCallback(async (solo?: CollectPhase[]) => {
    setInCorso(true);
    setErrore("");
    // Le fasi sono in ordine e hanno durate simili: mostrarle avanzare
    // e onesto quanto una barra finta, e dice a che punto siamo.
    const sequenza: CollectPhase[] = solo ?? ["places", "official_site", "social_discovery", "media", "reconcile"];
    let i = 0;
    setFaseCorrente(sequenza[0]);
    const tick = setInterval(() => {
      i = Math.min(i + 1, sequenza.length - 1);
      setFaseCorrente(sequenza[i]);
    }, 2500);
    try {
      await api("/api/collector/run", {
        method: "POST",
        body: JSON.stringify({ lead_id: leadId, ...(solo ? { solo } : {}) }),
      });
      await carica();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      clearInterval(tick);
      setFaseCorrente(null);
      setInCorso(false);
    }
  }, [leadId, carica]);

  const decidi = useCallback(async (m: MediaCandidate, decision: "approved" | "blocked") => {
    try {
      await api("/api/collector/dossier", {
        method: "PATCH",
        body: JSON.stringify({ lead_id: leadId, media_id: m.id, source_url: m.source_url, decision }),
      });
      await carica();
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, [leadId, carica]);

  const d = dati?.dossier ?? null;
  const fallite = (dati?.phases ?? []).filter((p) => p.status === "failed");
  // Il bottone e spento finche il runtime non e pronto, e la stessa
  // funzione decide sul server: se e acceso qui, la rotta accetta.
  const bloccato = cap ? !cap.pronto : true;

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-ui text-sm font-semibold uppercase tracking-[0.12em] text-text">
            Raccogli dati e fotografie
          </h3>
          <p className="mt-1 text-xs text-text2">
            {leadName ? `${leadName} — ` : ""}
            Google Places, sito ufficiale, profili collegati. Non genera il sito.
          </p>
        </div>
        <NeonButton
          variant="cyan"
          filled
          size="md"
          // Bersaglio pieno su telefono, compatto da 640px in su.
          className="w-full sm:w-auto min-h-[44px]"
          disabled={inCorso || bloccato}
          onClick={() => void avvia()}
        >
          {inCorso
            ? <><Loader2 className="h-4 w-4 animate-spin" /> {faseCorrente ? ETICHETTA_FASE[faseCorrente] : "Raccolgo…"}</>
            : <><Search className="h-4 w-4" /> {dati?.trovato ? "Rifai la raccolta" : "Raccogli"}</>}
        </NeonButton>
      </div>

      {/* Perche il bottone e spento. Il dettaglio completo sta nel
          pannello di stato sopra: qui si dice solo la conseguenza. */}
      {cap && !cap.pronto && (
        <div className="mt-3 rounded-sm border border-danger/40 bg-danger/5 p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-danger">
            <AlertTriangle className="h-3.5 w-3.5" /> «Raccogli» è disabilitato
          </p>
          <ul className="mt-1 space-y-1">
            {cap.motivi.map((m) => (
              <li key={m} className="text-[11px] leading-snug text-text2">— {m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Capacita presenti ma parziali: non bloccano, ma cambiano l'esito. */}
      {cap && cap.pronto && cap.note.length > 0 && (
        <ul className="mt-3 space-y-1">
          {cap.note.map((n) => (
            <li key={n} className="flex gap-2 text-[11px] leading-snug text-text2">
              <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0 text-ochre" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      {errore && (
        <p className="mt-3 rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {errore}
        </p>
      )}

      {/* Fasi: si vedono sempre, anche a riposo, cosi si sa cosa fa. */}
      {(inCorso || (dati?.phases?.length ?? 0) > 0) && (
        <ol className="mt-4 grid gap-1.5 sm:grid-cols-5">
          {(["places", "official_site", "social_discovery", "media", "reconcile"] as CollectPhase[]).map((f) => {
            const stato = dati?.phases?.find((p) => p.phase === f);
            const attiva = faseCorrente === f;
            return (
              <li
                key={f}
                className={cn(
                  "flex items-center gap-2 rounded-sm border px-2.5 py-2 text-[11px]",
                  attiva && "border-accent/50 bg-accent/5 text-accent",
                  !attiva && stato?.status === "ok" && "border-success/30 text-success",
                  !attiva && stato?.status === "failed" && "border-danger/40 text-danger",
                  !attiva && (!stato || stato.status === "skipped") && "border-border text-text2",
                )}
              >
                {attiva ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  : stato?.status === "ok" ? <CheckCircle2 className="h-3 w-3 shrink-0" />
                  : stato?.status === "failed" ? <AlertTriangle className="h-3 w-3 shrink-0" />
                  : <span className="h-3 w-3 shrink-0 rounded-full border border-current opacity-40" />}
                <span className="truncate">{ETICHETTA_FASE[f]}</span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Rilancio dei soli step falliti: non si ripaga quello che ha funzionato. */}
      {fallite.length > 0 && !inCorso && (
        <div className="mt-3 rounded-sm border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs text-danger">
            {fallite.length === 1 ? "Una fase non è riuscita" : `${fallite.length} fasi non sono riuscite`}:
            {" "}{fallite.map((p) => `${ETICHETTA_FASE[p.phase]} (${p.detail})`).join(" · ")}
          </p>
          <NeonButton
            variant="magenta" size="sm"
            className="mt-2 min-h-[40px] w-full sm:w-auto"
            disabled={bloccato}
            onClick={() => void avvia(fallite.map((p) => p.phase))}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Riprova solo queste
          </NeonButton>
        </div>
      )}

      {/* Rilancio mirato di social e fotografie.
          Serve quando la raccolta e andata ma si vuole ricontrollare
          solo quelle due cose: ripartire da Places costerebbe chiamate
          per riconfermare dati che non sono cambiati. Le fasi saltate
          si reidratano dal dossier precedente, quindi il rilancio
          integra invece di sovrascrivere. */}
      {d && !inCorso && (
        <div className="mt-3">
          <NeonButton
            variant="cyan" size="sm"
            className="min-h-[40px] w-full sm:w-auto"
            disabled={bloccato}
            onClick={() => void avvia(["social_discovery", "media", "reconcile"])}
          >
            <Search className="h-3.5 w-3.5" /> Riprendi social e fotografie
          </NeonButton>
        </div>
      )}

      {d && (() => {
        // Il link alla scheda Google: è dove l'attribuzione delle
        // fotografie del provider deve poter portare.
        const urlMaps = d.verified.concat(d.probable).find((f) => f.field === "maps_url")?.value
          || (d.place_id ? `https://www.google.com/maps/place/?q=place_id:${d.place_id}` : "");

        // I conti salvati nel dossier sono quelli del momento della
        // raccolta, quando nulla era ancora approvato. Le approvazioni
        // arrivano dopo e vivono altrove: si riportano qui, o i numeri
        // resterebbero fermi mentre l'operatore decide.
        const decisioni = dati?.decisioni ?? {};
        const conti = {
          ...d.media.counts,
          utilizzabili_in_demo: d.media.candidates.filter((m) =>
            decisioni[m.id] !== "blocked"
            && (m.display_status === "display_allowed"
              || m.display_status === "display_allowed_with_attribution"
              || decisioni[m.id] === "approved")).length,
          da_approvare: d.media.candidates.filter((m) =>
            m.display_status === "display_after_approval" && !decisioni[m.id]).length,
        };
        return (
        <div className="mt-4 space-y-4">
          {/* Le tre decisioni.
              Prima ce n'era una sola, e un'attività identificata con
              certezza ma senza sito finiva in REVIEW: il materiale
              mancante trascinava con sé il giudizio commerciale. Sono
              tre domande diverse e adesso hanno tre risposte. */}
          <div className="space-y-2">
            <Decisione
              etichetta="Opportunità commerciale"
              valore={d.commercial_recommendation}
              tono={TONO_COMMERCIALE[d.commercial_recommendation]}
              motivi={d.decision_reasons?.commercial ?? []}
              coda={
                <>
                  {d.cost.external_calls} chiamate · {(d.cost.total_ms / 1000).toFixed(1)}s
                  {d.website_opportunity_score !== null && (
                    <> · sito {d.website_opportunity_score}/100</>
                  )}
                  {d.search && d.search.queries > 0 && (
                    <> · {d.search.queries} ricerche</>
                  )}
                </>
              }
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Decisione
                etichetta="Materiale per la demo"
                valore={d.content_readiness}
                tono={TONO_CONTENUTO[d.content_readiness]}
                motivi={d.decision_reasons?.content ?? []}
              />
              <Decisione
                etichetta="Fotografie"
                valore={d.media_readiness}
                tono={TONO_MEDIA[d.media_readiness]}
                motivi={d.decision_reasons?.media ?? []}
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Numero titolo="Verificati" valore={d.verified.length} />
            <Numero titolo="Probabili" valore={d.probable.length} />
            <Numero titolo="Conflitti" valore={d.conflicts.length} allarme={d.conflicts.length > 0} />
            <Numero titolo="Mancanti" valore={d.missing.length} allarme={d.missing.length > 0} />
          </div>

          {/* Conflitti: non risolti, mostrati. */}
          {d.conflicts.length > 0 && (
            <section>
              <Titolo>Conflitti — decide una persona</Titolo>
              <ul className="mt-2 space-y-2">
                {d.conflicts.map((c) => (
                  <li key={c.conflict_group} className="rounded-sm border border-ochre/30 p-2.5">
                    <p className="text-xs font-medium text-text">
                      {c.field}{c.blocking && <span className="ml-2 text-[10px] uppercase tracking-wide text-danger">blocca</span>}
                    </p>
                    <p className="mt-1 break-words text-[11px] text-text2">
                      tenuto <span className="text-text">{c.kept.value}</span> ({c.kept.source_type})
                    </p>
                    {c.others.map((o) => (
                      <p key={o.value} className="break-words text-[11px] text-text2 line-through decoration-danger/40">
                        {o.value} ({o.source_type})
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {d.missing.length > 0 && (
            <section>
              <Titolo>Dati mancanti</Titolo>
              <p className="mt-1 text-[11px] text-text2">{d.missing.join(" · ")}</p>
            </section>
          )}

          {/* Profili */}
          <Sezione
            titolo={`Profili social (${d.identities.length})`}
            aperta={espandi === "profili"}
            onToggle={() => setEspandi(espandi === "profili" ? null : "profili")}
          >
            {d.identities.length === 0
              ? <p className="text-[11px] text-text2">Nessun profilo linkato dal sito ufficiale. Nessuna ricerca tentata: senza un link dichiarato non c&apos;è modo di verificare che un profilo sia suo.</p>
              : (
                <ul className="space-y-2">
                  {d.identities.map((c) => (
                    <li key={c.candidate_url} className="rounded-sm border border-border p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          "rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                          c.status === "confirmed" && "border-success/40 text-success",
                          c.status === "likely" && "border-ochre/40 text-ochre",
                          c.status === "unverified_candidate" && "border-border text-text2",
                          c.status === "rejected" && "border-danger/40 text-danger",
                          c.status === "browser_required" && "border-accent/40 text-accent",
                        )}>{ETICHETTA_IDENTITA[c.status]}</span>
                        <span className="text-[11px] text-text2">{c.platform} · {c.confidence}/100</span>
                        <a
                          href={c.candidate_url} target="_blank" rel="noreferrer noopener"
                          className="ml-auto inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                        >
                          apri <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <p className="mt-1 break-all text-[11px] text-text">{c.candidate_url}</p>
                      <p className="mt-1 text-[11px] leading-snug text-text2">{c.rationale}</p>
                    </li>
                  ))}
                </ul>
              )}
          </Sezione>

          {/* Fotografie */}
          <Sezione
            titolo={`Fotografie candidate (${d.media.candidates.length})`}
            aperta={espandi === "media"}
            onToggle={() => setEspandi(espandi === "media" ? null : "media")}
          >
            {/* Quattro numeri, non uno.
                «0 approvate» faceva sembrare che non ci fosse niente da
                mostrare, mentre le dieci fotografie di Google si possono
                rendere benissimo citando la fonte. Possedere
                un'immagine e poterla mostrare non sono la stessa cosa,
                e questi numeri tengono separate le due domande. */}
            <div className="mb-2 grid gap-2 grid-cols-2 sm:grid-cols-4">
              <Numero titolo="Via Google" valore={conti.tramite_provider ?? 0} />
              <Numero titolo="Proprietarie" valore={conti.proprietarie ?? 0} />
              <Numero titolo="Copiabili" valore={conti.copiabili ?? 0} />
              <Numero titolo="Usabili in demo" valore={conti.utilizzabili_in_demo} />
            </div>
            <p className="mb-2 text-[11px] leading-snug text-text2">
              Le fotografie di Google non sono nostre e non si conservano: si mostrano dal
              provider, con l&apos;attribuzione, e spariscono quando il riferimento scade.
              Quelle dei canali ufficiali entrano solo nella demo privata noindex finché non
              le approvi tu.
              {conti.da_approvare > 0 && (
                <> {conti.da_approvare} aspettano una tua decisione.</>
              )}
            </p>
            {d.media.candidates.length === 0
              ? <p className="text-[11px] text-text2">Nessuna immagine candidata.</p>
              : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {d.media.candidates.map((m) => {
                    const decisa = dati?.decisioni?.[m.id];
                    return (
                      <li key={m.id} className="rounded-sm border border-border p-2.5">
                        <Anteprima m={m} />
                        <div className="mt-2 flex items-start gap-2">
                          <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text2" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] text-text2">
                              {m.probable_role} · {m.width && m.height ? `${m.width}×${m.height}` : "misure ignote"}
                              {" · q"}{m.quality_score}{m.people_present ? " · persone" : ""}
                            </p>
                            <span className={cn(
                              "mt-1 inline-block rounded-sm border px-1.5 py-0.5 text-[10px]",
                              COLORE_DIRITTI[m.rights_status],
                            )}>{ETICHETTA_DIRITTI[m.rights_status]}</span>
                            {m.display_status === "display_allowed_with_attribution" && (
                              <span className="ml-1 inline-block rounded-sm border border-accent/40 px-1.5 py-0.5 text-[10px] text-accent">
                                mostrabile citando la fonte
                              </span>
                            )}
                            {/* L'attribuzione non è un dettaglio: è la
                                condizione a cui si può mostrare. Sta
                                sotto l'immagine, sempre, anche quando
                                l'autore non è dichiarato. */}
                            {m.provider_reference
                              ? (
                                <p className="mt-1 text-[10px] text-text2">
                                  {m.attribution ? `${m.attribution} — ` : ""}
                                  <a
                                    href={urlMaps}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="underline underline-offset-2 hover:text-accent"
                                  >Google Maps</a>
                                </p>
                              )
                              : (
                                <p className="mt-1 break-all text-[10px] text-text2">
                                  {m.source_url.slice(0, 70)}
                                  {m.attribution ? ` — ${m.attribution}` : ""}
                                </p>
                              )}
                          </div>
                        </div>
                        {/* Approvare e un atto di una persona: due bottoni grandi. */}
                        {/* Approvare vale solo per ciò che aspetta
                            un'approvazione. Una fotografia di Google
                            non diventa nostra perché la si approva:
                            mostrarla è già consentito, copiarla no. */}
                        {m.display_status === "display_after_approval" && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void decidi(m, "approved")}
                              className={cn(
                                "min-h-[40px] flex-1 rounded-sm border px-2 text-[11px] transition-colors",
                                decisa === "approved"
                                  ? "border-success bg-success/10 text-success"
                                  : "border-border text-text2 hover:border-success/50 hover:text-success",
                              )}
                            >
                              <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
                              {decisa === "approved" ? "Approvata" : "Approva"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void decidi(m, "blocked")}
                              className={cn(
                                "min-h-[40px] flex-1 rounded-sm border px-2 text-[11px] transition-colors",
                                decisa === "blocked"
                                  ? "border-danger bg-danger/10 text-danger"
                                  : "border-border text-text2 hover:border-danger/50 hover:text-danger",
                              )}
                            >
                              <Ban className="mr-1 inline h-3.5 w-3.5" />
                              {decisa === "blocked" ? "Bloccata" : "Blocca"}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            {d.media.rejected.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-text2">
                  {d.media.rejected.length} scartate — perché
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {d.media.rejected.map((r) => (
                    <li key={r.source_url} className="break-all text-[10px] text-text2">
                      {r.source_url.slice(0, 70)} — {r.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Sezione>

          {/* Fatti */}
          <Sezione
            titolo={`Fatti verificati (${d.verified.length})`}
            aperta={espandi === "fatti"}
            onToggle={() => setEspandi(espandi === "fatti" ? null : "fatti")}
          >
            <ul className="space-y-1">
              {d.verified.map((f, i) => (
                <li key={`${f.field}-${i}`} className="flex flex-wrap gap-x-2 text-[11px]">
                  <span className="text-text2">{f.field}</span>
                  <span className="text-text">{f.value}</span>
                  <span className="text-text2">
                    ({f.source_type} · {f.confidence}/100 · {f.extraction_method})
                  </span>
                </li>
              ))}
            </ul>
          </Sezione>

          {/* Fonti */}
          <Sezione
            titolo={`Fonti consultate (${d.sources.length})`}
            aperta={espandi === "fonti"}
            onToggle={() => setEspandi(espandi === "fonti" ? null : "fonti")}
          >
            <ul className="space-y-1">
              {d.sources.map((s, i) => (
                <li key={`${s.url}-${i}`} className="flex flex-wrap items-center gap-x-2 text-[11px]">
                  {s.ok ? <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                    : s.outcome === "browser_required" ? <Eye className="h-3 w-3 shrink-0 text-accent" />
                    : <HelpCircle className="h-3 w-3 shrink-0 text-text2" />}
                  <span className="text-text2">{s.source_type}</span>
                  <span className="min-w-0 break-all text-text">{s.url.slice(0, 70) || "—"}</span>
                  <span className="text-text2">{s.outcome}{s.detail ? `: ${s.detail}` : ""} · {s.ms}ms</span>
                </li>
              ))}
            </ul>
          </Sezione>
        </div>
        );
      })()}
    </GlassCard>
  );
}

function Numero({ titolo, valore, allarme }: { titolo: string; valore: number; allarme?: boolean }) {
  return (
    <div className="rounded-sm border border-border px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-text2">{titolo}</p>
      <p className={cn("font-ui text-lg", allarme ? "text-ochre" : "text-text")}>{valore}</p>
    </div>
  );
}

function Titolo({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="font-ui text-[11px] font-semibold uppercase tracking-[0.12em] text-text2">
      {children}
    </h4>
  );
}

function Sezione({
  titolo, aperta, onToggle, children,
}: { titolo: string; aperta: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[44px] w-full items-center justify-between px-3 text-left"
      >
        <span className="font-ui text-[11px] font-semibold uppercase tracking-[0.12em] text-text2">
          {titolo}
        </span>
        <span className="text-[11px] text-text2">{aperta ? "chiudi" : "apri"}</span>
      </button>
      {aperta && <div className="border-t border-border p-3">{children}</div>}
    </section>
  );
}

/** Una delle tre decisioni. Il valore grande, le ragioni sotto: chi
 *  guarda deve capire in un colpo COSA si è deciso e in due righe
 *  PERCHÉ, senza aprire niente. */
function Decisione({
  etichetta, valore, tono, motivi, coda,
}: {
  etichetta: string;
  valore: string;
  tono: Tono;
  motivi: string[];
  coda?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-sm border p-3", BORDO[tono])}>
      <p className="text-[10px] uppercase tracking-wide text-text2">{etichetta}</p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn(
          "font-ui text-sm font-semibold uppercase tracking-[0.12em]",
          TESTO[tono],
        )}>{valore || "—"}</span>
        {coda && <span className="text-[11px] text-text2">{coda}</span>}
      </div>
      <ul className="mt-2 space-y-1">
        {motivi.map((m) => (
          <li key={m} className="text-[11px] leading-snug text-text2">— {m}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Un'anteprima di fotografia.
 *
 * Per le immagini di Google Places non si usa mai l'URL del provider:
 * quello vuole la chiave API, e una chiave dentro una pagina è una
 * chiave pubblica. Si passa da `/api/collector/foto`, che aggiunge la
 * chiave sul server e restituisce i byte con `Cache-Control: no-store`.
 *
 * Il riferimento fotografico di Places ha una scadenza. Quando è
 * scaduto la rotta risponde 410 e qui si mostra perché, invece di un
 * riquadro rotto che sembrerebbe un guasto nostro.
 */
function Anteprima({ m }: { m: MediaCandidate }) {
  const [rotta, setRotta] = useState(false);
  const daProvider = Boolean(m.provider_reference);
  const src = daProvider
    ? `/api/collector/foto?ref=${encodeURIComponent(m.provider_reference)}&w=400`
    : m.source_url;

  if (rotta || m.display_status === "display_forbidden") {
    return (
      <div className="flex h-24 items-center justify-center rounded-sm border border-border bg-bg2/40 px-2 text-center">
        <span className="text-[10px] leading-snug text-text2">
          {m.display_status === "display_forbidden"
            ? "non mostrabile: provenienza non riconducibile a un canale ufficiale"
            : daProvider
              ? "riferimento scaduto — rilancia la raccolta per aggiornarlo"
              : "immagine non caricabile"}
        </span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={m.probable_role}
      loading="lazy"
      onError={() => setRotta(true)}
      className="h-24 w-full rounded-sm object-cover"
    />
  );
}
