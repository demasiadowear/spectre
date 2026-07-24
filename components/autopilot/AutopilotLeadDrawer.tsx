"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  Check,
  ExternalLink,
  Phone,
  RefreshCw,
  Search,
  Send,
  Star,
  X,
} from "lucide-react";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { googleSearchHref } from "@/lib/pitch";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type { AutopilotLead, AutopilotStage, WaMessage } from "@/types/autopilot";
import { DEAL_STAGES } from "@/types/autopilot";
import {
  HEAT_BADGE,
  STAGE_CHIP,
  STAGE_LABELS,
  leadHeat,
  qualityLabel,
  stageLabel,
  timeAgo,
} from "./format";

/** Esito di un'azione conversazione (dal route /api/autopilot/conversation). */
export interface ConversationResult {
  lead: AutopilotLead;
  suggested?: { reply: string; note: string } | null;
  triage?: { stage: AutopilotStage; label: string };
}

interface Props {
  lead: AutopilotLead | null;
  /** "chat" scrolla subito alla conversazione (azione "Apri"). */
  focus?: "chat";
  busy: boolean;
  onClose: () => void;
  onArchive: (leadId: string) => void;
  /** Stato trattativa + prossima azione + note: tutto manuale. */
  onUpdateDeal: (leadId: string, fields: Record<string, unknown>) => void;
  /** Registra un nostro messaggio inviato a mano (e segna "contattato"). */
  onLogOutbound: (leadId: string, body: string) => Promise<ConversationResult | null>;
  /** Registra la risposta del cliente incollata: triage + suggerimento. */
  onLogInbound: (leadId: string, body: string) => Promise<ConversationResult | null>;
  /** Rigenera la risposta suggerita sulla conversazione corrente. */
  onSuggest: (leadId: string) => Promise<ConversationResult | null>;
  /** Segna la demo inviata a mano (link incollato + mandato su WA). */
  onMarkDemoSent: (leadId: string, demoUrl?: string) => Promise<ConversationResult | null>;
  /** Prezzo manuale del lead (€). null = nessun prezzo. */
  onSetPrice: (leadId: string, price: number | null) => Promise<ConversationResult | null>;
}

// ============================================================
// Drawer di dettaglio — copilota MANUALE. Niente worker: Puccio
// manda da "Apri in WhatsApp" (wa.me precompilato) e incolla qui
// la risposta del cliente; SPECTRE la cataloga e prepara la bozza
// della prossima risposta.
// ============================================================

/** Link wa.me con testo precompilato (numero italiano normalizzato). */
function waHref(phone: string, text = ""): string | null {
  let d = phone.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (!d.startsWith("39")) d = `39${d}`;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${d}${q}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-surface2 px-5 py-4">
      <h3 className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Bottone "Apri in WhatsApp" — attivo solo se mobile. Per i fissi è
 *  disabilitato (tooltip) e accanto compare "Chiama" (tel:). */
function WaActions({
  href,
  enabled,
  isMobile,
  telHref,
}: {
  href: string;
  /** testo presente / link valido (a parte il tipo numero). */
  enabled: boolean;
  isMobile: boolean;
  telHref: string | null;
}) {
  const active = enabled && isMobile;
  return (
    <>
      <a
        href={active ? href : "#"}
        target="_blank"
        rel="noreferrer"
        title={isMobile ? undefined : "numero fisso, niente WA"}
        aria-disabled={!active}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-ui text-xs font-semibold",
          active
            ? "border-success/50 bg-success/10 text-success hover:bg-success/20"
            : "pointer-events-none border-border text-text2 opacity-40",
        )}
      >
        <Send className="h-3.5 w-3.5" /> Apri in WhatsApp
      </a>
      {!isMobile && telHref && (
        <a
          href={telHref}
          className="inline-flex items-center gap-1.5 rounded-sm border border-accent/50 bg-accent/10 px-3 py-1.5 font-ui text-xs font-semibold text-accent hover:bg-accent/20"
        >
          <Phone className="h-3.5 w-3.5" /> Chiama
        </a>
      )}
    </>
  );
}

export default function AutopilotLeadDrawer({
  lead,
  focus,
  busy,
  onClose,
  onArchive,
  onUpdateDeal,
  onLogOutbound,
  onLogInbound,
  onSuggest,
  onMarkDemoSent,
  onSetPrice,
}: Props) {
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [msgVersion, setMsgVersion] = useState(0);
  const [firstDraft, setFirstDraft] = useState("");
  const [inboundDraft, setInboundDraft] = useState("");
  const [suggestion, setSuggestion] = useState<{ reply: string; note: string } | null>(null);
  const [suggestDraft, setSuggestDraft] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [demoDraft, setDemoDraft] = useState("");
  const [priceDraft, setPriceDraft] = useState("");
  // Form trattativa (stato + prossima azione + note): si salva in blocco.
  const [dealStage, setDealStage] = useState<AutopilotStage | "">("");
  const [dealAction, setDealAction] = useState("");
  const [dealDate, setDealDate] = useState("");
  const [dealNotes, setDealNotes] = useState("");
  const [dealLost, setDealLost] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  const leadId = lead?.lead_id ?? null;
  const working = busy || localBusy;

  // Reset dei campi SOLO al cambio di lead (non a ogni poll/refresh, così
  // la bozza suggerita e i draft non si azzerano sotto le mani).
  useEffect(() => {
    setMessages([]);
    setMsgVersion(0);
    setFirstDraft(lead?.wa_first_message ?? "");
    setInboundDraft("");
    setSuggestion(null);
    setSuggestDraft("");
    setDemoDraft(lead?.demo_url ?? "");
    setPriceDraft(lead?.price != null ? String(lead.price) : "");
    setDealStage(
      lead && (DEAL_STAGES as string[]).includes(lead.stage) ? lead.stage : "",
    );
    setDealAction(lead?.next_action ?? "");
    setDealDate(lead?.next_action_at ? lead.next_action_at.slice(0, 16) : "");
    setDealNotes(lead?.notes ?? "");
    setDealLost(lead?.lost_reason ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // Chat completa caricata on-open e dopo ogni azione (msgVersion).
  useEffect(() => {
    if (!leadId) return;
    let alive = true;
    fetch(`/api/autopilot/pipeline?lead_id=${encodeURIComponent(leadId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((res: ApiResponse<{ messages?: WaMessage[] }>) => {
        if (alive && res.success) setMessages(res.data?.messages ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [leadId, msgVersion]);

  useEffect(() => {
    if (focus === "chat" && messages.length > 0) {
      chatRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [focus, messages.length]);

  // ESC chiude.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Scroll lock sul body a drawer aperto.
  useEffect(() => {
    if (!lead) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lead]);

  const run = useCallback(
    async (fn: () => Promise<ConversationResult | null>) => {
      setLocalBusy(true);
      try {
        const res = await fn();
        setMsgVersion((v) => v + 1);
        return res;
      } finally {
        setLocalBusy(false);
      }
    },
    [],
  );

  if (!lead) return null;

  const phone = lead.phone;
  const isMobile = lead.phone_type === "mobile";
  const telHref = phone ? `tel:${phone.replace(/\s+/g, "")}` : null;
  const lastInbound =
    messages.length > 0 && messages[messages.length - 1].direction === "in";
  const notContacted = lead.stage === "da_contattare";
  const conversational =
    lead.stage === "contattato" ||
    lead.stage === "ha_risposto" ||
    lead.stage === "in_trattativa";

  // ----- handler locali ---------------------------------------

  async function sendFirst() {
    if (!firstDraft.trim()) return;
    await run(() => onLogOutbound(lead!.lead_id, firstDraft.trim()));
  }

  async function registerInbound() {
    if (!inboundDraft.trim()) return;
    const res = await run(() => onLogInbound(lead!.lead_id, inboundDraft.trim()));
    setInboundDraft("");
    if (res?.suggested) {
      setSuggestion(res.suggested);
      setSuggestDraft(res.suggested.reply);
    } else {
      setSuggestion({ reply: "", note: "" });
      setSuggestDraft("");
    }
  }

  async function regenerate() {
    const res = await run(() => onSuggest(lead!.lead_id));
    if (res?.suggested) {
      setSuggestion(res.suggested);
      setSuggestDraft(res.suggested.reply);
    }
  }

  async function sendSuggested() {
    if (!suggestDraft.trim()) return;
    await run(() => onLogOutbound(lead!.lead_id, suggestDraft.trim()));
    setSuggestion(null);
    setSuggestDraft("");
  }

  async function sendDemo() {
    await run(() => onMarkDemoSent(lead!.lead_id, demoDraft.trim() || undefined));
  }

  async function savePrice() {
    const t = priceDraft.trim();
    const price = t === "" ? null : Number(t);
    if (price != null && (!Number.isFinite(price) || price < 0)) return;
    await run(() => onSetPrice(lead!.lead_id, price));
  }

  const showSuggestion = suggestion !== null || (conversational && lastInbound);

  return createPortal(
    <AnimatePresence>
      {lead && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-scrim/40"
          />
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.22 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto border-l border-border bg-surface shadow-card sm:w-[460px]"
            role="dialog"
            aria-label={`Dettaglio ${lead.company}`}
          >
            {/* header */}
            <div className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg font-bold text-text">
                    {lead.company}
                  </h2>
                  <p className="font-ui text-xs text-text2">
                    {lead.category} · {lead.city}
                    {lead.rating > 0 && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5">
                        <Star className="h-3 w-3 fill-ochre text-ochre" />
                        {lead.rating.toFixed(1)} ({lead.reviews})
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Chiudi dettaglio"
                  className="rounded-sm border border-border p-1.5 text-text2 hover:text-text"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {qualityLabel(lead) && (
                  <span
                    className={cn(
                      "rounded-sm border px-1.5 py-0.5 font-ui text-[10px] font-semibold",
                      HEAT_BADGE[leadHeat(lead)],
                    )}
                    title="Qualità: stelle Google + recensioni"
                  >
                    {qualityLabel(lead)}
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 font-ui text-[11px]",
                    STAGE_CHIP[lead.stage],
                  )}
                >
                  {stageLabel(lead)}
                </span>
                {phone && (
                  <a
                    href={telHref ?? "#"}
                    className="inline-flex items-center gap-1 font-ui text-xs text-accent hover:underline"
                  >
                    <Phone className="h-3 w-3" /> {phone}
                  </a>
                )}
                {lead.phone_type === "mobile" && (
                  <span className="inline-flex items-center gap-0.5 rounded-sm border border-success/40 px-1.5 py-0.5 font-ui text-[10px] text-success">
                    📱 mobile
                  </span>
                )}
                {lead.phone_type === "fisso" && (
                  <span
                    className="inline-flex items-center gap-0.5 rounded-sm border border-ochre/50 px-1.5 py-0.5 font-ui text-[10px] text-ochre"
                    title="Numero fisso: niente WhatsApp, solo chiamata"
                  >
                    ☎ fisso
                  </span>
                )}
                <a
                  href={googleSearchHref(lead.company, lead.city)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-ui text-xs text-accent hover:underline"
                >
                  <Search className="h-3 w-3" /> Cerca
                </a>
              </div>
              {lead.address && (
                <p className="mt-1 font-ui text-xs text-text2">{lead.address}</p>
              )}
            </div>

            {lead.brief && (
              <Section title="Lead brief">
                <p className="whitespace-pre-line font-ui text-sm leading-relaxed text-text">
                  {lead.brief}
                </p>
              </Section>
            )}

            {lead.study && lead.study.recent_reviews.length > 0 && (
              <Section title="Recensioni recenti">
                <ul className="space-y-2">
                  {lead.study.recent_reviews.slice(0, 3).map((r, i) => (
                    <li key={i} className="font-ui text-xs text-text2">
                      <span className="text-ochre">{"★".repeat(r.rating)}</span>
                      {r.when && <span className="ml-1">({r.when})</span>}{" "}
                      <span className="text-text">“{r.text}”</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {lead.study && lead.study.gaps.length > 0 && (
              <Section title="Gap senza sito">
                <ul className="list-inside list-disc space-y-1 font-ui text-xs text-text2">
                  {lead.study.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </Section>
            )}

            {/* PRIMO MESSAGGIO — solo finché non contattato. Lo mandi tu da
                WhatsApp, poi "Segna come inviato" fa avanzare la pipeline. */}
            {notContacted && lead.wa_first_message && (
              <Section title="Primo messaggio WA">
                {lead.wa_variant && (
                  <span className="mb-2 inline-flex items-center rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-ui text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
                    Variante {lead.wa_variant}
                  </span>
                )}
                <textarea
                  value={firstDraft}
                  onChange={(e) => setFirstDraft(e.target.value)}
                  rows={5}
                  className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <WaActions
                    href={waHref(phone, firstDraft) ?? "#"}
                    enabled={Boolean(phone) && Boolean(firstDraft.trim())}
                    isMobile={isMobile}
                    telHref={telHref}
                  />
                  <NeonButton
                    size="sm"
                    variant="cyan"
                    filled
                    disabled={working || !firstDraft.trim()}
                    onClick={sendFirst}
                  >
                    <Check className="h-3.5 w-3.5" /> Segna come inviato
                  </NeonButton>
                </div>
                <p className="mt-1 font-ui text-[10px] text-text2">
                  Apri WhatsApp col messaggio già scritto, rivedilo e invialo.
                  Poi segna come inviato.
                </p>
              </Section>
            )}

            {/* RISPOSTA DEL CLIENTE — incolla cosa ti ha scritto: triage +
                bozza della prossima risposta. */}
            {conversational && (
              <Section title="Risposta del cliente">
                <textarea
                  value={inboundDraft}
                  onChange={(e) => setInboundDraft(e.target.value)}
                  rows={3}
                  placeholder="Incolla qui cosa ti ha risposto il cliente su WhatsApp…"
                  className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                />
                <div className="mt-2">
                  <NeonButton
                    size="sm"
                    variant="cyan"
                    filled
                    disabled={working || !inboundDraft.trim()}
                    onClick={registerInbound}
                  >
                    <Check className="h-3.5 w-3.5" /> Registra risposta
                  </NeonButton>
                </div>
              </Section>
            )}

            {/* RISPOSTA SUGGERITA — bozza editabile, la mandi tu da WhatsApp. */}
            {showSuggestion && (
              <Section title="Risposta suggerita">
                {suggestion?.note && (
                  <p className="mb-2 font-ui text-xs text-ochre">💡 {suggestion.note}</p>
                )}
                <textarea
                  value={suggestDraft}
                  onChange={(e) => setSuggestDraft(e.target.value)}
                  rows={4}
                  placeholder={
                    suggestion
                      ? "Bozza vuota: scrivi la risposta a mano o rigenera."
                      : "Genera una bozza di risposta sulla conversazione."
                  }
                  className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <WaActions
                    href={waHref(phone, suggestDraft) ?? "#"}
                    enabled={Boolean(phone) && Boolean(suggestDraft.trim())}
                    isMobile={isMobile}
                    telHref={telHref}
                  />
                  <NeonButton
                    size="sm"
                    variant="cyan"
                    filled
                    disabled={working || !suggestDraft.trim()}
                    onClick={sendSuggested}
                  >
                    <Check className="h-3.5 w-3.5" /> Segna come inviato
                  </NeonButton>
                  <NeonButton size="sm" variant="ghost" disabled={working} onClick={regenerate}>
                    <RefreshCw className={cn("h-3.5 w-3.5", working && "animate-spin")} />{" "}
                    {suggestion ? "Rigenera" : "Genera bozza"}
                  </NeonButton>
                </div>
              </Section>
            )}

            {/* Prezzo manuale: lo decide Puccio lead per lead, vuoto di
                default. Nessun prezzo automatico dal sistema. */}
            <Section title="Prezzo (manuale)">
              <div className="flex items-center gap-2">
                <span className="font-ui text-sm text-text2">€</span>
                <input
                  type="number"
                  min={0}
                  value={priceDraft}
                  onChange={(e) => setPriceDraft(e.target.value)}
                  placeholder="es. 499 (vuoto = nessun prezzo)"
                  className="w-40 rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                />
                <NeonButton size="sm" variant="cyan" disabled={working} onClick={savePrice}>
                  <Check className="h-3.5 w-3.5" /> Salva
                </NeonButton>
              </div>
            </Section>

            {/* Trattativa: stati manuali. */}
            {lead.stage !== "da_contattare" && lead.stage !== "archiviato" && (
                <Section title="Trattativa">
                  <div className="space-y-2">
                    <div>
                      <label className="mb-1 block font-ui text-[10px] uppercase tracking-[0.15em] text-text2">
                        Stato
                      </label>
                      <select
                        value={dealStage}
                        onChange={(e) => setDealStage(e.target.value as AutopilotStage | "")}
                        className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                      >
                        <option value="">— lascia com&apos;è ({STAGE_LABELS[lead.stage]}) —</option>
                        {DEAL_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {STAGE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {dealStage === "perso" && (
                      <div>
                        <label className="mb-1 block font-ui text-[10px] uppercase tracking-[0.15em] text-text2">
                          Motivo perso
                        </label>
                        <input
                          type="text"
                          value={dealLost}
                          onChange={(e) => setDealLost(e.target.value)}
                          placeholder="prezzo / non interessato / ha già fornitore…"
                          className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block font-ui text-[10px] uppercase tracking-[0.15em] text-text2">
                          Prossima azione
                        </label>
                        <input
                          type="text"
                          value={dealAction}
                          onChange={(e) => setDealAction(e.target.value)}
                          placeholder="es. chiamare per appuntamento"
                          className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block font-ui text-[10px] uppercase tracking-[0.15em] text-text2">
                          Quando (agenda)
                        </label>
                        <input
                          type="datetime-local"
                          value={dealDate}
                          onChange={(e) => setDealDate(e.target.value)}
                          className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block font-ui text-[10px] uppercase tracking-[0.15em] text-text2">
                        Note (cosa ci siamo detti)
                      </label>
                      <textarea
                        value={dealNotes}
                        onChange={(e) => setDealNotes(e.target.value)}
                        rows={3}
                        className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                      />
                    </div>
                    <NeonButton
                      size="sm"
                      variant="cyan"
                      filled
                      disabled={working || (dealStage === "perso" && !dealLost.trim())}
                      onClick={() =>
                        onUpdateDeal(lead.lead_id, {
                          ...(dealStage ? { stage: dealStage } : {}),
                          next_action: dealAction.trim(),
                          next_action_at: dealDate || "",
                          notes: dealNotes,
                          ...(dealStage === "perso"
                            ? { lost_reason: dealLost.trim() }
                            : {}),
                        })
                      }
                    >
                      <Check className="h-3.5 w-3.5" /> Salva trattativa
                    </NeonButton>
                  </div>
                </Section>
              )}

            {/* Demo: SPECTRE non builda nulla. Prepari la demo fuori,
                incolli il link e la mandi a mano da WhatsApp. */}
            {(lead.stage === "ha_risposto" || lead.stage === "in_trattativa") && (
              <Section title="Demo">
                {lead.demo_sent_at ? (
                  <>
                    <p className="font-ui text-xs text-success">
                      ✓ Demo inviata al cliente · {timeAgo(lead.demo_sent_at)}
                    </p>
                    {lead.demo_url && (
                      <a
                        href={lead.demo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 break-all font-ui text-sm text-accent hover:underline"
                      >
                        {lead.demo_url} <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      type="url"
                      value={demoDraft}
                      onChange={(e) => setDemoDraft(e.target.value)}
                      placeholder="https://demo-cliente.vercel.app"
                      className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <WaActions
                        href={
                          waHref(
                            phone,
                            demoDraft.trim()
                              ? `Ecco la demo del sito: ${demoDraft.trim()}`
                              : "",
                          ) ?? "#"
                        }
                        enabled={/^https?:\/\/\S+$/.test(demoDraft.trim()) && Boolean(phone)}
                        isMobile={isMobile}
                        telHref={telHref}
                      />
                      <NeonButton
                        size="sm"
                        variant="cyan"
                        filled
                        disabled={working || !/^https?:\/\/\S+$/.test(demoDraft.trim())}
                        onClick={sendDemo}
                      >
                        <Check className="h-3.5 w-3.5" /> Segna demo inviata
                      </NeonButton>
                    </div>
                    <p className="mt-1 font-ui text-[10px] text-text2">
                      Prepari la demo fuori da SPECTRE. Mandi il link a mano su
                      WhatsApp, poi segna come inviata.
                    </p>
                  </>
                )}
              </Section>
            )}

            <div ref={chatRef}>
              <Section title={`Chat WA (${messages.length})`}>
                {messages.length === 0 ? (
                  <p className="font-ui text-xs text-text2">Nessun messaggio ancora.</p>
                ) : (
                  <ul className="space-y-2">
                    {messages.map((m) => (
                      <li
                        key={m.id}
                        className={cn(
                          "max-w-[85%] rounded-md p-2 font-ui text-sm",
                          m.direction === "out"
                            ? "ml-auto bg-accent/10 text-text"
                            : "bg-surface2 text-text",
                        )}
                      >
                        <p className="whitespace-pre-line">{m.body}</p>
                        <p className="mt-0.5 text-right text-[10px] text-text2">
                          {m.direction === "out" ? "tu" : "cliente"} ·{" "}
                          {timeAgo(m.created_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            {lead.stage !== "archiviato" && (
              <div className="mt-auto border-t border-border px-5 py-3">
                <NeonButton
                  size="sm"
                  variant="ghost"
                  disabled={working}
                  onClick={() => onArchive(lead.lead_id)}
                >
                  <Archive className="h-3.5 w-3.5" /> Archivia lead
                </NeonButton>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
