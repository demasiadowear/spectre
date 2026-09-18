"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Camera, CheckCircle2, Crosshair,
  Loader2, Star, Trash2, X,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";

// ============================================================
// Il provino, e le sei decisioni che si possono prendere guardandolo.
//
// QUESTA SCHERMATA ESISTE PER NON FAR CLASSIFICARE A MANO OGNI
// FOTOGRAFIA DI OGNI LEAD. L'analisi propone; qui si guarda e si
// corregge quello che serve — spesso niente, a volte l'apertura, a
// volte un ritaglio. Se per usarla bisogna toccare dieci fotografie,
// non ha funzionato.
//
// I DUE RIQUADRI DI ANTEPRIMA. Ogni fotografia scelta si vede in due
// proporzioni, larga e alta, con il ritaglio applicato. Sono li perche
// i difetti del ritaglio — un viso tagliato a meta, un soggetto fuori
// dalla lastra — non si vedono nel provino quadrato: si sono visti in
// produzione, che e il posto sbagliato per vederli.
//
// Non si mostra `candidate_id`: e l'identita con cui il client rimanda
// indietro le scelte, non una cosa da leggere. Compare solo dove serve
// a capire di quale fotografia si sta parlando, e li basta il numero.
// ============================================================

type Stato = "unreviewed" | "selected" | "not_selected" | "needs_visual_review" | "needs_review";
type Ruolo = "hero" | "treatment" | "interior" | "detail" | "closing";

interface FotoInProvino {
  candidate_id: string;
  indice: number;
  src: string;
  larghezza: number;
  altezza: number;
  attribuzione: string;
  attribuzione_obbligatoria: boolean;
  stato: Stato;
  layout_role: Ruolo | "";
  object_position: string;
  order: number;
  motivo_revisione: string;
  nuova: boolean;
}

interface Provino {
  project_id: string;
  slug: string;
  foto: FotoInProvino[];
  basis_revision: string;
  manifest_revision: string;
  proposal_revision: string;
  approvata_il: string;
  analisi_in_corso: boolean;
  proposal_status: "complete" | "incomplete";
  codice: string;
  minimo_in_pagina: number;
  messaggio: string;
  bloccante: boolean;
  brand: { status: string; uso: string; nota: string };
  costo: { immagini: number; token: number; durata_ms: number; modello: string };
  pubblicata: {
    proposal_revision: string; foto: number; mancanti: number;
    apertura_mancante: boolean; stato: "ok" | "degraded"; avviso: string;
  } | null;
  tetti: { immagini: number; in_pagina: number };
  ruoli: string[];
}

const ETICHETTA_RUOLO: Record<Ruolo, string> = {
  hero: "Apertura",
  treatment: "Trattamento",
  interior: "Ambiente",
  detail: "Dettaglio",
  closing: "Chiusura",
};

/**
 * Perche una fotografia e dove sta.
 *
 * «Forse c'e un marchio» copriva quattro situazioni diverse e le
 * trattava tutte come un ostacolo: e cosi che nove fotografie su dieci
 * sono finite fuori pagina e in copertina e rimasto un mucchio di
 * asciugamani. Un marchio incidentale non e un motivo e qui non compare
 * proprio: la fotografia sta in pagina, e non c'e niente da spiegare.
 */
const ETICHETTA_REVISIONE: Record<string, string> = {
  bassa_confidenza: "Il modello non è sicuro",
  possibile_persona_identificabile: "Persona riconoscibile — guarda prima di pubblicare",
  marchio_attivita_possibile: "Possibile identità dell’attività — verifica",
  marchio_estraneo_dominante: "Marchio estraneo dominante — verifica",
  qualita_insufficiente: "Luce, fuoco o soggetto non sufficienti",
  genere_non_utilizzabile: "Tessili, deposito o soffitto — non va in pagina",
  analisi_non_disponibile: "Non è stata guardata",
  // Lettura dei dati vecchi: prima il marchio era un valore solo.
  possibile_marchio: "Marchio incidentale — non blocca",
};

/** Cosa dice lo stato del marchio, in una riga. `NOT_FOUND` non e un
 *  guasto: e il caso normale, e la pagina compone il nome. */
const ETICHETTA_BRAND: Record<string, string> = {
  ORIGINAL_CONFIRMED: "Logo originale verificato",
  ORIGINAL_PROBABLE: "Logo probabile — da approvare",
  SIGNAGE_ONLY: "Solo insegna",
  INCONCLUSIVE: "Candidati ambigui",
  NOT_FOUND: "Nessun logo: nome composto tipograficamente",
  PENDING: "Identità visiva non ancora cercata",
  RETRY_REQUIRED: "Una fonte non ha risposto",
  BLOCKED: "Manca una capacità: serve configurazione",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = (await res.json()) as { success: boolean; data?: T; error?: string };
  if (!j.success) throw new Error(j.error ?? `errore ${res.status}`);
  return j.data as T;
}

export default function PannelloProposta({ leadId }: { leadId: string }) {
  const [p, setP] = useState<Provino | null>(null);
  const [scelte, setScelte] = useState<FotoInProvino[]>([]);
  const [errore, setErrore] = useState("");
  const [nota, setNota] = useState("");
  const [analizzando, setAnalizzando] = useState(false);
  const [approvando, setApprovando] = useState(false);
  const [fuoco, setFuoco] = useState("");
  // L'anteprima non esiste ancora: non e un errore da mostrare, e una
  // schermata che non ha senso aprire. Si tace.
  const [assente, setAssente] = useState(false);

  const carica = useCallback(async () => {
    try {
      const d = await api<Provino>(`/api/demo/proposta?lead_id=${encodeURIComponent(leadId)}`);
      setP(d);
      setScelte(d.foto.filter((f) => f.stato === "selected").sort((a, b) => a.order - b.order));
      setAssente(false);
    } catch (e) {
      const m = (e as Error).message;
      if (/anteprima/i.test(m)) { setAssente(true); return; }
      setErrore(m);
    }
  }, [leadId]);

  useEffect(() => { void carica(); }, [carica]);

  const analizza = useCallback(async (refresh: boolean) => {
    setAnalizzando(true);
    setErrore("");
    setNota("");
    try {
      await api(`/api/demo/analizza`, {
        method: "POST",
        // Il progetto si nomina per identita, non per lead: fra la
        // lettura e il comando non deve poterci stare un progetto
        // diverso creato nel frattempo.
        body: JSON.stringify({ project_id: p?.project_id, lead_id: leadId, refresh }),
      });
      await carica();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setAnalizzando(false);
    }
  }, [p, leadId, carica]);

  const decidi = useCallback(async (azione: "approva" | "rifiuta") => {
    if (!p) return;
    setApprovando(true);
    setErrore("");
    setNota("");
    try {
      const r = await api<{ pubblicata: boolean; avviso: string; confronto: { prima: { foto: number }; dopo: { foto: number } } }>(
        "/api/demo/approva",
        {
          method: "POST",
          body: JSON.stringify({
            project_id: p.project_id,
            basis_revision: p.basis_revision,
            azione,
            scelte: scelte.map((s, i) => ({
              candidate_id: s.candidate_id,
              order: i,
              layout_role: s.layout_role || "detail",
              object_position: s.object_position,
            })),
          }),
        },
      );
      setNota(
        azione === "rifiuta"
          ? "Proposta rifiutata. La demo online non è stata toccata."
          : `Pubblicata: ${r.confronto.prima.foto} → ${r.confronto.dopo.foto} fotografie in pagina.${r.avviso ? ` ${r.avviso}` : ""}`,
      );
      await carica();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setApprovando(false);
    }
  }, [p, scelte, carica]);

  // ----- Le sei azioni sulla composizione ---------------------------

  const sposta = (i: number, d: -1 | 1) => {
    setScelte((v) => {
      const j = i + d;
      if (j < 0 || j >= v.length) return v;
      const out = v.slice();
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  };

  /** Cambia apertura: il ruolo `hero` e uno solo, quindi si sposta e
   *  non si aggiunge. La fotografia va anche in testa: l'apertura in
   *  terza posizione non e un'apertura. */
  const cambiaApertura = (id: string) => {
    setScelte((v) => {
      const out = v.map((f) => ({
        ...f,
        layout_role: (f.candidate_id === id ? "hero" : f.layout_role === "hero" ? "detail" : f.layout_role) as Ruolo,
      }));
      const k = out.findIndex((f) => f.candidate_id === id);
      if (k > 0) out.unshift(out.splice(k, 1)[0]);
      return out;
    });
  };

  const rimuovi = (id: string) => setScelte((v) => v.filter((f) => f.candidate_id !== id));

  const aggiungi = (f: FotoInProvino) => {
    setScelte((v) => {
      if (v.length >= (p?.tetti.in_pagina ?? 5)) return v;
      if (v.some((x) => x.candidate_id === f.candidate_id)) return v;
      return v.concat({ ...f, layout_role: v.some((x) => x.layout_role === "hero") ? "detail" : "hero" });
    });
  };

  const regolaFuoco = (id: string, x: number, y: number) => {
    setScelte((v) => v.map((f) =>
      f.candidate_id === id ? { ...f, object_position: `${x}% ${y}%` } : f));
  };

  const nonScelte = useMemo(() => {
    if (!p) return [];
    const dentro = new Set(scelte.map((s) => s.candidate_id));
    return p.foto.filter((f) => !dentro.has(f.candidate_id));
  }, [p, scelte]);

  // Nessuna apertura fotografica non blocca piu: la pagina si apre con
  // il nome, ed e una composizione progettata. Si dice, non si impedisce.
  const senzaApertura = scelte.length > 0 && !scelte.some((s) => s.layout_role === "hero");
  const brandFerma = p?.brand.status === "PENDING" || p?.brand.status === "RETRY_REQUIRED"
    || p?.brand.status === "BLOCKED";

  if (assente) return null;

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-ui text-sm font-semibold uppercase tracking-[0.12em] text-text">
            Analizza foto e identità
          </h3>
          <p className="mt-1 text-xs text-text2">
            Il modello guarda le fotografie e propone apertura, sequenza e ritaglio.
            Tu correggi quello che serve e approvi. Niente esce da qui senza il tuo sì.
          </p>
        </div>
        <NeonButton
          variant="cyan" filled size="md"
          className="w-full min-h-[44px] sm:w-auto"
          disabled={analizzando || p?.analisi_in_corso}
          onClick={() => void analizza(false)}
        >
          {analizzando || p?.analisi_in_corso
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Analizzo…</>
            : <><Camera className="h-4 w-4" /> {p?.foto.length ? "Analizza" : "Analizza foto e identità"}</>}
        </NeonButton>
      </div>

      {/* Il costo previsto PRIMA di spenderlo. */}
      <p className="mt-2 text-[11px] leading-snug text-text2">
        Costo previsto: fino a {p?.tetti.immagini ?? 10} immagini a una chiamata sola,
        più una ricerca per il marchio. Se le fotografie non sono cambiate dall’ultima
        analisi, non si rispende: serve «rianalizza» esplicito.
      </p>

      {errore && (
        <p className="mt-3 rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {errore}
        </p>
      )}
      {nota && (
        <p className="mt-3 rounded-sm border border-success/40 bg-success/5 px-3 py-2 text-xs text-success">
          {nota}
        </p>
      )}

      {/* Il messaggio preciso: cosa è successo e cosa fare adesso. */}
      {p?.messaggio && (
        <div className={cn(
          "mt-3 rounded-sm border p-3",
          p.bloccante ? "border-danger/40 bg-danger/5" : "border-ochre/40 bg-ochre/5",
        )}>
          <p className={cn("flex gap-2 text-xs leading-snug", p.bloccante ? "text-danger" : "text-ochre")}>
            <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0" />
            <span>{p.messaggio}</span>
          </p>
          {p.bloccante && (
            <NeonButton
              variant="magenta" size="sm" className="mt-2 min-h-[40px] w-full sm:w-auto"
              disabled={analizzando}
              onClick={() => void analizza(true)}
            >
              <Camera className="h-3.5 w-3.5" /> Riesegui l’analisi
            </NeonButton>
          )}
        </div>
      )}

      {/* L'analisi e finita senza scegliere niente. Non e un errore e
          non e un successo: e un risultato che non si puo usare, e il
          pulsante spento da solo non lo spiega a nessuno. */}
      {p?.proposal_status === "incomplete" && (
        <p className="mt-2 text-[11px] leading-snug text-text2">
          {scelte.length === 0
            ? "Nessuna fotografia è stata selezionata dall’analisi. Puoi metterne una in pagina a mano dall’elenco qui sotto, oppure rieseguire."
            : `In pagina ce ne sono ${scelte.length}: ne servono almeno ${p.minimo_in_pagina} perché sia una pagina. Aggiungine dall’elenco qui sotto, oppure riesegui.`}
        </p>
      )}

      {/* Lo stato del marchio. `NOT_FOUND` non è un guasto. */}
      {p?.brand.status && (
        <div className={cn(
          "mt-3 rounded-sm border p-2.5",
          brandFerma ? "border-danger/40 bg-danger/5" : "border-border",
        )}>
          <p className="text-[11px] font-medium text-text">
            Identità visiva: {ETICHETTA_BRAND[p.brand.status] ?? p.brand.status}
          </p>
          {p.brand.nota && <p className="mt-1 text-[11px] leading-snug text-text2">{p.brand.nota}</p>}
        </div>
      )}

      {/* Cosa è online adesso. */}
      {p?.pubblicata && (
        <div className="mt-3 rounded-sm border border-border p-2.5">
          <p className="text-[11px] text-text2">
            Online: {p.pubblicata.foto} fotografie
            {p.pubblicata.mancanti > 0 && ` · ${p.pubblicata.mancanti} non più disponibili`}
            {/* `degraded` non vuol dire rotta: la pagina si apre. Vuol
                dire che non e piu quella approvata, ed e un fatto che
                si vede solo aprendola — cioe di solito dopo averla
                mandata a qualcuno. */}
            {p.pubblicata.stato === "degraded" && (
              <span className="ml-1.5 rounded-sm border border-ochre/40 px-1 text-[10px] uppercase tracking-wide text-ochre">
                degradata
              </span>
            )}
          </p>
          {p.pubblicata.avviso && (
            <p className="mt-1 text-[11px] leading-snug text-ochre">{p.pubblicata.avviso}</p>
          )}
        </div>
      )}

      {/* ----- La composizione ----- */}
      {scelte.length > 0 && (
        <section className="mt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text2">
            In pagina — {scelte.length} di {p?.tetti.in_pagina ?? 5}
          </h4>
          {senzaApertura && (
            <p className="mt-1 text-[11px] leading-snug text-text2">
              Nessuna fotografia ha i requisiti per l’apertura: la demo si aprirà
              con il nome dell’attività. Puoi metterne una in apertura tu, se ne
              vedi una adatta.
            </p>
          )}
          <ul className="mt-2 space-y-3">
            {scelte.map((f, i) => {
              const [fx, fy] = leggiFuoco(f.object_position);
              return (
                <li key={f.candidate_id} className="rounded-sm border border-border p-2.5">
                  <div className="flex gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={f.src} alt="" width={f.larghezza} height={f.altezza}
                      className="h-20 w-20 shrink-0 rounded-sm object-cover"
                      style={{ objectPosition: f.object_position }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-text">
                        <span className={cn(
                          "rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                          f.layout_role === "hero" ? "border-accent/50 text-accent" : "border-border text-text2",
                        )}>
                          {ETICHETTA_RUOLO[(f.layout_role || "detail") as Ruolo]}
                        </span>
                        <span className="text-text2">n. {f.indice}</span>
                      </p>
                      {/* L'attribuzione sta accanto ALLA SUA fotografia:
                          una riga collettiva sotto la galleria non dice
                          quale immagine è di chi. */}
                      <p className="mt-1 break-words text-[11px] leading-snug text-text2">
                        {f.attribuzione || "senza attribuzione dichiarata"}
                        {f.attribuzione_obbligatoria && " · obbligatoria"}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Azione onClick={() => sposta(i, -1)} disabled={i === 0} titolo="Sposta su">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Azione>
                        <Azione onClick={() => sposta(i, 1)} disabled={i === scelte.length - 1} titolo="Sposta giù">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Azione>
                        <Azione
                          onClick={() => cambiaApertura(f.candidate_id)}
                          disabled={f.layout_role === "hero"}
                          titolo="Metti in apertura"
                        >
                          <Star className="h-3.5 w-3.5" /> Apertura
                        </Azione>
                        <Azione
                          onClick={() => setFuoco(fuoco === f.candidate_id ? "" : f.candidate_id)}
                          titolo="Regola il fuoco"
                        >
                          <Crosshair className="h-3.5 w-3.5" /> Fuoco
                        </Azione>
                        <Azione onClick={() => rimuovi(f.candidate_id)} titolo="Togli dalla pagina">
                          <Trash2 className="h-3.5 w-3.5" /> Rimuovi
                        </Azione>
                      </div>
                    </div>
                  </div>

                  {/* Il ritaglio, e come viene nelle due proporzioni. */}
                  {fuoco === f.candidate_id && (
                    <div className="mt-3 border-t border-border pt-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Anteprima titolo="Desktop" src={f.src} pos={f.object_position} rapporto="16 / 9" />
                        <Anteprima titolo="Telefono" src={f.src} pos={f.object_position} rapporto="3 / 4" />
                      </div>
                      <Cursore etichetta="Orizzontale" valore={fx}
                        onChange={(v) => regolaFuoco(f.candidate_id, v, fy)} />
                      <Cursore etichetta="Verticale" valore={fy}
                        onChange={(v) => regolaFuoco(f.candidate_id, fx, v)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ----- Il resto del provino ----- */}
      {nonScelte.length > 0 && (
        <section className="mt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text2">
            Non in pagina — {nonScelte.length}
          </h4>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {nonScelte.map((f) => (
              <li key={f.candidate_id} className="rounded-sm border border-border p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.src} alt="" width={f.larghezza} height={f.altezza}
                  className="h-24 w-full rounded-sm object-cover"
                  style={{ objectPosition: f.object_position }}
                />
                <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-text2">
                  <span>n. {f.indice}</span>
                  {f.nuova && <span className="text-accent">nuova</span>}
                  {(f.stato === "needs_visual_review" || f.stato === "needs_review") && (
                    <span className="text-ochre">
                      {ETICHETTA_REVISIONE[f.motivo_revisione] ?? "da guardare"}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 break-words text-[10px] leading-snug text-text2">
                  {f.attribuzione}
                </p>
                <button
                  type="button"
                  className="mt-1 min-h-[32px] w-full rounded-sm border border-border text-[11px] text-text2 hover:text-text"
                  onClick={() => aggiungi(f)}
                  disabled={scelte.length >= (p?.tetti.in_pagina ?? 5)}
                >
                  Metti in pagina
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ----- Approva o rifiuta ----- */}
      {p && p.foto.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
          <NeonButton
            variant="cyan" filled size="md"
            className="min-h-[44px] w-full sm:w-auto"
            // La stessa regola del server. Il pulsante spento e una
            // cortesia: se qualcuno lo forza, la rotta risponde 409.
            disabled={
              approvando || p.bloccante || brandFerma
              || scelte.length < p.minimo_in_pagina
            }
            onClick={() => void decidi("approva")}
          >
            {approvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approva e pubblica
          </NeonButton>
          <NeonButton
            variant="magenta" size="md"
            className="min-h-[44px] w-full sm:w-auto"
            disabled={approvando}
            onClick={() => void decidi("rifiuta")}
          >
            <X className="h-4 w-4" /> Rifiuta
          </NeonButton>
          <p className="self-center text-[11px] leading-snug text-text2">
            {p.costo.immagini > 0 && (
              <>{p.costo.immagini} immagini · {p.costo.token} token · {(p.costo.durata_ms / 1000).toFixed(1)}s</>
            )}
          </p>
        </div>
      )}
    </GlassCard>
  );
}

// ----- Pezzi -----------------------------------------------------------

function Azione({ children, onClick, disabled, titolo }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; titolo: string;
}) {
  return (
    <button
      type="button"
      title={titolo}
      aria-label={titolo}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-[36px] items-center gap-1 rounded-sm border border-border px-2 text-[11px]",
        disabled ? "opacity-40" : "text-text2 hover:text-text",
      )}
    >{children}</button>
  );
}

/** Come viene il ritaglio nelle due proporzioni che contano. Non e una
 *  decorazione: e il posto in cui si vede un viso tagliato a meta
 *  PRIMA che lo veda il prospect. */
function Anteprima({ titolo, src, pos, rapporto }: {
  titolo: string; src: string; pos: string; rapporto: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-text2">{titolo}</p>
      <div className="mt-1 overflow-hidden rounded-sm border border-border" style={{ aspectRatio: rapporto }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="h-full w-full object-cover" style={{ objectPosition: pos }} />
      </div>
    </div>
  );
}

function Cursore({ etichetta, valore, onChange }: {
  etichetta: string; valore: number; onChange: (v: number) => void;
}) {
  return (
    <label className="mt-2 block text-[11px] text-text2">
      <span className="flex justify-between"><span>{etichetta}</span><span>{valore}%</span></span>
      <input
        type="range" min={0} max={100} step={5} value={valore}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-6 w-full"
      />
    </label>
  );
}

function leggiFuoco(pos: string): [number, number] {
  const m = /^(\d{1,3})%\s+(\d{1,3})%$/.exec(pos || "");
  return m ? [Number(m[1]), Number(m[2])] : [50, 50];
}
