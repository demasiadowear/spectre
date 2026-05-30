"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Copy,
  Globe,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Star,
  X,
} from "lucide-react";
import { LEAD_STATUS } from "@/lib/constants";
import { cn, formatCurrency } from "@/lib/utils";
import {
  activityType,
  fbUrl,
  generateStep1,
  generateStep2,
  generateStep3,
  googleSearchUrl,
  igUrl,
  isMobilePhone,
  leadPricing,
  mapsUrl,
  nextBestAction,
  telUrl,
  waUrl,
  type PitchActionKind,
} from "@/lib/pitch";
import type { ApiResponse, Lead, LeadMeta, LeadStatus } from "@/types";

interface LeadActionPanelProps {
  lead: Lead | null;
  closedCount: number;
  onClose: () => void;
  onUpdate: (lead: Lead) => void;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error("clipboard unavailable"));
}

const nowIso = () => new Date().toISOString();

/** Set the stage timestamp matching a status as the lead enters it. */
function stamp(status: LeadStatus, meta: LeadMeta): LeadMeta {
  const t = nowIso();
  if (status === "step1_sent") return { ...meta, step1_at: t };
  if (status === "replied") return { ...meta, replied_at: t };
  if (status === "step2_sent") return { ...meta, step2_at: t };
  if (status === "preview_sent") return { ...meta, preview_at: t };
  if (status === "closed") return { ...meta, closed_at: t };
  return meta;
}

export default function LeadActionPanel({
  lead,
  closedCount,
  onClose,
  onUpdate,
}: LeadActionPanelProps) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setNotes(lead?.notes ?? "");
  }, [lead]);

  if (!lead) return null;

  const mobile = isMobilePhone(lead.phone);
  const pricing = leadPricing(lead, closedCount);
  const action = nextBestAction(lead);
  const a = activityType(lead);
  const sm = LEAD_STATUS[lead.status];

  const messages = [
    { step: 1, label: "Step 1 · Primo contatto", text: generateStep1(lead) },
    { step: 2, label: "Step 2 · Conferma preview", text: generateStep2(lead) },
    { step: 3, label: "Step 3 · Consegna + prezzo", text: generateStep3(lead, pricing) },
  ];
  const primaryStep =
    lead.status === "replied"
      ? 2
      : ["step2_sent", "preview_sent", "negotiating"].includes(lead.status)
        ? 3
        : 1;

  async function patch(body: Partial<Lead>) {
    if (!lead) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: ApiResponse<Lead> = await res.json();
      if (json.success && json.data) onUpdate(json.data);
    } catch {
      /* network errors are non-fatal here; the optimistic UI stays */
    } finally {
      setBusy(false);
    }
  }

  function advance(status: LeadStatus, extra: Partial<LeadMeta> = {}) {
    if (!lead) return;
    void patch({
      status,
      meta: { ...stamp(status, lead.meta), ...extra },
      last_contact: nowIso(),
    });
  }

  function markClosed() {
    if (!lead) return;
    const input = window.prompt(
      `Chiusura "${lead.name}"\nTier ${pricing.tier} · prezzo suggerito €${pricing.prezzo}\n\nPrezzo finale concordato (€):`,
      String(pricing.prezzo),
    );
    if (input === null) return;
    const price = parseFloat(input.replace(/[^\d.]/g, ""));
    if (Number.isNaN(price)) return;
    void patch({
      status: "closed",
      probability: 100,
      meta: { ...lead.meta, closed_at: nowIso(), closed_price: price },
      last_contact: nowIso(),
    });
  }

  function markLost() {
    if (!lead) return;
    const reason = window.prompt("Motivo (opzionale):", "") ?? "";
    void patch({ status: "lost", meta: { ...lead.meta, lost_reason: reason } });
  }

  async function sendStep(step: number) {
    if (!lead) return;
    const text = messages[step - 1].text;
    let done = false;
    try {
      await copyText(text);
      done = true;
    } catch {
      done = false;
    }
    setCopied(step);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1800);

    // Auto-advance the funnel on the matching send.
    if (step === 1 && lead.status === "todo") advance("step1_sent");
    else if (step === 2 && lead.status === "replied") advance("step2_sent");
    else if (step === 3 && lead.status === "step2_sent") advance("preview_sent");

    if (mobile) {
      window.open(waUrl(lead.phone, text), "_blank");
    } else if (!done) {
      window.prompt("Numero fisso, niente WhatsApp. Copia il messaggio:", text);
    }
  }

  async function copyOnly(step: number) {
    try {
      await copyText(messages[step - 1].text);
      setCopied(step);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1800);
    } catch {
      window.prompt("Copia il messaggio:", messages[step - 1].text);
    }
  }

  const runAction = (kind: PitchActionKind) => {
    switch (kind) {
      case "open_step1": return sendStep(1);
      case "open_step2": return sendStep(2);
      case "open_step3": return sendStep(3);
      case "set_replied": return advance("replied");
      case "set_negotiating": return advance("negotiating");
      case "mark_closed": return markClosed();
      case "mark_lost": return markLost();
      case "reopen":
        return patch({ status: "todo", meta: { ...lead.meta, lost_reason: undefined } });
      default: return undefined;
    }
  };

  const ig = igUrl(lead);
  const fb = fbUrl(lead);

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
      />
      <motion.aside
        key="panel"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        className="fixed inset-y-0 right-0 z-[61] flex w-full flex-col border-l border-spectre-cyan/20 bg-spectre-panel/98 backdrop-blur-2xl sm:max-w-[460px]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em]",
                  sm.badge,
                )}
              >
                {sm.label}
              </span>
              <span className="rounded-sm border border-[#ff6a00]/40 bg-[#ff6a00]/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-[#ff8c42]">
                {pricing.tier} · {formatCurrency(pricing.prezzo)}
              </span>
            </div>
            <h2 className="mt-2 font-display text-base font-bold leading-tight text-spectre-text">
              {lead.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-spectre-muted">
              {lead.meta.rating != null && (
                <span className="flex items-center gap-1 text-spectre-amber">
                  <Star className="h-3 w-3 fill-spectre-amber" strokeWidth={0} />
                  {lead.meta.rating}
                  {lead.meta.reviews != null && (
                    <span className="text-spectre-muted">({lead.meta.reviews})</span>
                  )}
                </span>
              )}
              <span>{a.sing}</span>
              {lead.phone && (
                <span className={mobile ? "text-spectre-green" : "text-spectre-muted"}>
                  {mobile ? "📱 WA" : "☎ fisso"}
                </span>
              )}
            </div>
            {lead.meta.address && (
              <p className="mt-1 font-mono text-[11px] text-spectre-muted/70">
                {lead.meta.address}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="shrink-0 rounded-sm p-1.5 text-spectre-muted transition-colors hover:bg-white/5 hover:text-spectre-magenta"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Contact links */}
          <div className="flex flex-wrap gap-2">
            {mobile && (
              <a
                href={waUrl(lead.phone, messages[primaryStep - 1].text)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm bg-[#25D366] px-3 font-mono text-[11px] font-semibold text-black"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </a>
            )}
            {lead.phone && (
              <a
                href={telUrl(lead.phone)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm border border-spectre-amber/40 bg-spectre-amber/10 px-3 font-mono text-[11px] text-spectre-amber"
              >
                <Phone className="h-3.5 w-3.5" /> Chiama
              </a>
            )}
            <a
              href={mapsUrl(lead)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm border border-spectre-cyan/30 bg-spectre-cyan/10 px-3 font-mono text-[11px] text-spectre-cyan"
            >
              <MapPin className="h-3.5 w-3.5" /> Maps
            </a>
            <a
              href={googleSearchUrl(lead)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm border border-white/15 bg-white/5 px-3 font-mono text-[11px] text-spectre-muted"
            >
              <Search className="h-3.5 w-3.5" /> Cerca
            </a>
            {ig && (
              <a
                href={ig}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm border border-spectre-magenta/30 bg-spectre-magenta/10 px-3 font-mono text-[11px] text-spectre-magenta"
              >
                <Globe className="h-3.5 w-3.5" /> IG
              </a>
            )}
            {fb && (
              <a
                href={fb}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm border border-spectre-cyan/30 bg-spectre-cyan/10 px-3 font-mono text-[11px] text-spectre-cyan"
              >
                <Globe className="h-3.5 w-3.5" /> FB
              </a>
            )}
          </div>

          {/* Next best action */}
          <div
            className={cn(
              "mt-4 rounded-sm border p-3",
              action.urgent
                ? "border-spectre-magenta/50 bg-spectre-magenta/10"
                : "border-[#ff6a00]/40 bg-[#ff6a00]/10",
            )}
          >
            <p className="font-display text-sm font-bold text-spectre-text">
              {action.title}
            </p>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-spectre-muted">
              {action.desc}
            </p>
            {action.cta && action.kind && (
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(action.kind)}
                className={cn(
                  "mt-2.5 inline-flex min-h-[40px] items-center rounded-sm px-4 font-mono text-xs font-bold uppercase tracking-[0.12em] text-black disabled:opacity-50",
                  action.urgent ? "bg-spectre-magenta" : "bg-[#ff6a00]",
                )}
              >
                → {action.cta}
              </button>
            )}
          </div>

          {/* Message blocks */}
          <div className="mt-4 flex flex-col gap-2">
            {messages.map((m) => {
              const primary = m.step === primaryStep;
              return (
                <details
                  key={m.step}
                  open={primary}
                  className={cn(
                    "group rounded-sm border bg-black/30",
                    primary ? "border-spectre-cyan/40" : "border-white/10",
                  )}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-spectre-cyan">
                    {m.label}
                    <span className="text-spectre-muted/50 group-open:hidden">▾</span>
                  </summary>
                  <div className="px-3 pb-3">
                    <pre className="whitespace-pre-wrap break-words rounded-sm bg-black/40 p-2.5 font-sans text-[12px] leading-relaxed text-spectre-text/90">
                      {m.text}
                    </pre>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => sendStep(m.step)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm bg-[#25D366] px-3 font-mono text-[11px] font-semibold text-black disabled:opacity-50"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {mobile ? "Apri WhatsApp" : "Copia per WA"}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyOnly(m.step)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm border border-white/15 px-3 font-mono text-[11px] text-spectre-muted"
                      >
                        {copied === m.step ? (
                          <Check className="h-3.5 w-3.5 text-spectre-green" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copied === m.step ? "Copiato" : "Copia"}
                      </button>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>

          {/* Notes */}
          <div className="mt-4">
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted">
              Note
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Es: ha già Instagram attivo, chiamare dopo le 15…"
              className="w-full resize-y rounded-sm border border-spectre-cyan/20 bg-black/50 px-3 py-2 font-mono text-[12px] text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-cyan/50 focus:outline-none"
            />
            {notes.trim() !== (lead.notes ?? "").trim() && (
              <button
                type="button"
                disabled={busy}
                onClick={() => patch({ notes: notes.trim() })}
                className="mt-1.5 inline-flex min-h-[34px] items-center rounded-sm border border-spectre-cyan/40 px-3 font-mono text-[11px] text-spectre-cyan disabled:opacity-50"
              >
                Salva nota
              </button>
            )}
          </div>
        </div>

        {/* Status footer (always reachable, no drag needed) */}
        <div className="border-t border-white/10 p-3">
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-muted">
            Cambia stato
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FLOW[lead.status].map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => advance(s)}
                className={cn(
                  "inline-flex min-h-[34px] items-center rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] disabled:opacity-50",
                  LEAD_STATUS[s].badge,
                )}
              >
                {LEAD_STATUS[s].label}
              </button>
            ))}
            {lead.status !== "closed" && (
              <button
                type="button"
                disabled={busy}
                onClick={markClosed}
                className="inline-flex min-h-[34px] items-center rounded-sm border border-spectre-green/40 bg-spectre-green/10 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-spectre-green disabled:opacity-50"
              >
                € Chiuso
              </button>
            )}
            {lead.status !== "lost" && (
              <button
                type="button"
                disabled={busy}
                onClick={markLost}
                className="inline-flex min-h-[34px] items-center rounded-sm border border-zinc-500/40 bg-zinc-500/10 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-400 disabled:opacity-50"
              >
                ✕ Lost
              </button>
            )}
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}

// Allowed forward/back transitions per stage (closed/lost handled separately).
const STATUS_FLOW: Record<LeadStatus, LeadStatus[]> = {
  todo: ["step1_sent"],
  step1_sent: ["replied", "todo"],
  replied: ["step2_sent", "step1_sent"],
  step2_sent: ["preview_sent", "replied"],
  preview_sent: ["negotiating", "step2_sent"],
  negotiating: ["preview_sent"],
  closed: ["preview_sent"],
  lost: ["todo"],
};
