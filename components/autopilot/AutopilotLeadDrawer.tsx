"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  Check,
  ExternalLink,
  Phone,
  Search,
  Star,
  X,
} from "lucide-react";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { googleSearchHref } from "@/lib/pitch";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type { AutopilotLead, AutopilotStage, WaMessage } from "@/types/autopilot";
import { DEAL_STAGES } from "@/types/autopilot";
import { STAGE_LABELS } from "./format";
import {
  STAGE_CHIP,
  TIER_BADGE,
  isPendingApproval,
  stageLabel,
  timeAgo,
} from "./format";

interface Props {
  lead: AutopilotLead | null;
  /** "chat" scrolla subito alla conversazione (azione "Apri chat"). */
  focus?: "chat";
  busy: boolean;
  onClose: () => void;
  onApprove: (leadId: string, message?: string) => void;
  onReject: (leadId: string) => void;
  onArchive: (leadId: string) => void;
  /** Link demo preparato FUORI da SPECTRE: incolla + approva e il
   *  worker lo invia. SPECTRE non builda nulla. */
  onApproveDemoUrl: (leadId: string, demoUrl: string) => void;
  /** Stato trattativa + prossima azione + note: tutto manuale,
   *  nessun automatismo verso il lead. */
  onUpdateDeal: (leadId: string, fields: Record<string, unknown>) => void;
}

// ============================================================
// Drawer laterale di dettaglio: TUTTO quello che non sta in
// riga (recensioni, brief, telefono, messaggio WA editabile,
// chat completa, demo). Su mobile occupa l'intera larghezza.
// ============================================================

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-surface2 px-5 py-4">
      <h3 className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function AutopilotLeadDrawer({
  lead,
  focus,
  busy,
  onClose,
  onApprove,
  onReject,
  onArchive,
  onApproveDemoUrl,
  onUpdateDeal,
}: Props) {
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [demoDraft, setDemoDraft] = useState("");
  // Form trattativa (stato + prossima azione + note): si salva in blocco.
  const [dealStage, setDealStage] = useState<AutopilotStage | "">("");
  const [dealAction, setDealAction] = useState("");
  const [dealDate, setDealDate] = useState("");
  const [dealNotes, setDealNotes] = useState("");
  const [dealLost, setDealLost] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  // Chat completa caricata on-open (non pesa sulla lista).
  useEffect(() => {
    setMessages([]);
    setDraft(lead?.wa_first_message ?? "");
    setDemoDraft(lead?.demo_url ?? "");
    setDealStage(
      lead && (DEAL_STAGES as string[]).includes(lead.stage) ? lead.stage : "",
    );
    setDealAction(lead?.next_action ?? "");
    setDealDate(lead?.next_action_at ? lead.next_action_at.slice(0, 16) : "");
    setDealNotes(lead?.notes ?? "");
    setDealLost(lead?.lost_reason ?? "");
    if (!lead) return;
    let alive = true;
    fetch(`/api/autopilot/pipeline?lead_id=${encodeURIComponent(lead.lead_id)}`, {
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
  }, [lead]);

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

  // Scroll lock sul body a drawer aperto (è portaled su body: senza
  // lock la pagina sotto scrolla e il pannello sembra "tagliato").
  useEffect(() => {
    if (!lead) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lead]);

  const pending = lead ? isPendingApproval(lead) : false;
  const waLink = lead?.phone
    ? `https://wa.me/${lead.phone.replace(/\D/g, "")}`
    : null;

  // Portal su document.body: dentro il layout HUD un antenato con
  // transform rompe position:fixed e il drawer esce tagliato.
  if (!lead) return null;

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
                <span
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 font-ui text-[10px] font-bold",
                    TIER_BADGE[lead.tier] ?? TIER_BADGE.T3,
                  )}
                >
                  {lead.tier}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 font-ui text-[11px]",
                    STAGE_CHIP[lead.stage],
                  )}
                >
                  {stageLabel(lead)}
                </span>
                {lead.phone && (
                  <a
                    href={waLink ?? `tel:${lead.phone}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-ui text-xs text-accent hover:underline"
                  >
                    <Phone className="h-3 w-3" /> {lead.phone}
                  </a>
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

            {lead.stage === "escalation" && (
              <Section title="Escalation">
                <p className="font-ui text-sm text-danger">
                  ⚠ {lead.escalation_reason || "richiesta da gestire di persona"}
                  <span className="ml-1 text-text2">
                    · {timeAgo(lead.escalated_at)} — bot fermo, chiusura a voce
                  </span>
                </p>
              </Section>
            )}

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

            {lead.wa_first_message && (
              <Section title="Primo messaggio WA">
                {pending ? (
                  <>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={5}
                      className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                    />
                    <div className="mt-2 flex gap-2">
                      <NeonButton
                        size="sm"
                        variant="green"
                        disabled={busy}
                        onClick={() => onApprove(lead.lead_id, draft)}
                      >
                        <Check className="h-3.5 w-3.5" /> Approva
                      </NeonButton>
                      <NeonButton
                        size="sm"
                        variant="magenta"
                        disabled={busy}
                        onClick={() => onReject(lead.lead_id)}
                      >
                        <X className="h-3.5 w-3.5" /> Scarta
                      </NeonButton>
                    </div>
                  </>
                ) : (
                  <p className="whitespace-pre-line rounded-sm border border-surface2 bg-bg p-2 font-ui text-sm text-text">
                    {lead.wa_first_message}
                  </p>
                )}
              </Section>
            )}

            {/* Trattativa: stati manuali di Puccio. Nessun automatismo
                verso il lead, il bot resta muto: qui si tiene solo il
                filo (chi chiamo, chi aspetta la demo, chi è tiepido). */}
            {lead.stage !== "nuovo" &&
              lead.stage !== "studiato" &&
              lead.stage !== "archiviato" && (
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
                          Quando (agenda + promemoria WA)
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
                      disabled={busy || (dealStage === "perso" && !dealLost.trim())}
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

            {/* Demo: SPECTRE non builda nulla. Puccio prepara la demo
                fuori, incolla qui il link e approva: il worker invia il
                messaggio (template demo_ready) al prossimo tick. */}
            {(lead.stage === "demo_richiesta" || lead.stage === "demo_inviata") && (
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
                ) : lead.demo_url ? (
                  <p className="font-ui text-xs text-text2">
                    Demo approvata, invio in coda al worker:{" "}
                    <a
                      href={lead.demo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-accent hover:underline"
                    >
                      {lead.demo_url}
                    </a>
                  </p>
                ) : (
                  <>
                    <input
                      type="url"
                      value={demoDraft}
                      onChange={(e) => setDemoDraft(e.target.value)}
                      placeholder="https://demo-cliente.vercel.app"
                      className="w-full rounded-sm border border-border bg-bg p-2 font-ui text-sm text-text focus:border-accent focus:outline-none"
                    />
                    <div className="mt-2">
                      <NeonButton
                        size="sm"
                        variant="green"
                        disabled={busy || !/^https?:\/\/\S+$/.test(demoDraft.trim())}
                        onClick={() => onApproveDemoUrl(lead.lead_id, demoDraft.trim())}
                      >
                        <Check className="h-3.5 w-3.5" /> Approva e invia al cliente
                      </NeonButton>
                      <p className="mt-1 font-ui text-[10px] text-text2">
                        La demo la prepari tu fuori da SPECTRE. Con l&apos;approvazione
                        il worker manda il link su WhatsApp al lead.
                      </p>
                    </div>
                  </>
                )}
              </Section>
            )}

            <div ref={chatRef}>
              <Section title={`Chat WA (${messages.length})`}>
                {messages.length === 0 ? (
                  <p className="font-ui text-xs text-text2">
                    Nessun messaggio ancora.
                  </p>
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
                          {m.direction === "out"
                            ? `${m.ai_generated ? "bot" : "tu"} · ${m.status}`
                            : m.ai_generated
                              ? "cliente · auto-reply"
                              : "cliente"}{" "}
                          · {timeAgo(m.created_at)}
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
                  disabled={busy}
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
