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
  BusinessDossier, CapabilityReport, CollectPhase, IdentityCandidate,
  MediaCandidate, PhaseState, RightsStatus,
} from "@/types/dossier";

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

const ETICHETTA_IDENTITA: Record<IdentityCandidate["status"], string> = {
  verified: "Confermato",
  probable: "Probabile",
  ambiguous: "Incerto",
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
  const [cap, setCap] = useState<(CapabilityReport & { note: string[] }) | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [faseCorrente, setFaseCorrente] = useState<CollectPhase | null>(null);
  const [errore, setErrore] = useState("");
  const [espandi, setEspandi] = useState<"fatti" | "media" | "profili" | "fonti" | null>(null);

  const carica = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([
        api<RispostaDossier>(`/api/collector/dossier?lead_id=${encodeURIComponent(leadId)}`),
        api<CapabilityReport & { note: string[] }>("/api/collector/capability"),
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
          disabled={inCorso || cap?.google_places_configured === false}
          onClick={() => void avvia()}
        >
          {inCorso
            ? <><Loader2 className="h-4 w-4 animate-spin" /> {faseCorrente ? ETICHETTA_FASE[faseCorrente] : "Raccolgo…"}</>
            : <><Search className="h-4 w-4" /> {dati?.trovato ? "Rifai la raccolta" : "Raccogli"}</>}
        </NeonButton>
      </div>

      {/* Capacita mancanti: si dicono per nome, mai col valore. */}
      {cap && cap.note.length > 0 && (
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
            onClick={() => void avvia(fallite.map((p) => p.phase))}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Riprova solo queste
          </NeonButton>
        </div>
      )}

      {d && (
        <div className="mt-4 space-y-4">
          {/* Raccomandazione: la prima cosa che si legge. */}
          <div className={cn(
            "rounded-sm border p-3",
            d.recommendation === "GO" && "border-success/40 bg-success/5",
            d.recommendation === "REVIEW" && "border-ochre/40 bg-ochre/5",
            d.recommendation === "REJECT" && "border-danger/40 bg-danger/5",
          )}>
            <div className="flex items-center gap-2">
              <span className={cn(
                "font-ui text-sm font-semibold uppercase tracking-[0.12em]",
                d.recommendation === "GO" && "text-success",
                d.recommendation === "REVIEW" && "text-ochre",
                d.recommendation === "REJECT" && "text-danger",
              )}>{d.recommendation}</span>
              <span className="text-[11px] text-text2">
                {d.cost.external_calls} chiamate · {(d.cost.total_ms / 1000).toFixed(1)}s
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {d.recommendation_reasons.map((m) => (
                <li key={m} className="text-[11px] leading-snug text-text2">— {m}</li>
              ))}
            </ul>
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
                          c.status === "verified" && "border-success/40 text-success",
                          c.status === "probable" && "border-ochre/40 text-ochre",
                          c.status === "ambiguous" && "border-border text-text2",
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
            <p className="mb-2 text-[11px] leading-snug text-text2">
              Nessuna di queste è un asset autorizzato. Quelle trovate sui canali ufficiali
              entrano solo nella demo privata noindex finché non le approvi tu.
            </p>
            {d.media.candidates.length === 0
              ? <p className="text-[11px] text-text2">Nessuna immagine candidata.</p>
              : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {d.media.candidates.map((m) => {
                    const decisa = dati?.decisioni?.[m.id];
                    return (
                      <li key={m.id} className="rounded-sm border border-border p-2.5">
                        <div className="flex items-start gap-2">
                          <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text2" />
                          <div className="min-w-0 flex-1">
                            <p className="break-all text-[11px] text-text">{m.source_url.slice(0, 90)}</p>
                            <p className="mt-1 text-[10px] text-text2">
                              {m.probable_role} · {m.width && m.height ? `${m.width}×${m.height}` : "misure ignote"}
                              {" · q"}{m.quality_score}{m.people_present ? " · persone" : ""}
                            </p>
                            <span className={cn(
                              "mt-1 inline-block rounded-sm border px-1.5 py-0.5 text-[10px]",
                              COLORE_DIRITTI[m.rights_status],
                            )}>{ETICHETTA_DIRITTI[m.rights_status]}</span>
                            {m.attribution && (
                              <p className="mt-1 text-[10px] text-text2">attribuzione: {m.attribution}</p>
                            )}
                          </div>
                        </div>
                        {/* Approvare e un atto di una persona: due bottoni grandi. */}
                        {m.rights_status !== "forbidden" && m.rights_status !== "unknown" && (
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
      )}
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
