"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  mapsUrl,
  nextBestAction,
  telUrl,
  waUrl,
  type PitchActionKind,
} from "@/lib/pitch";
import type { ApiResponse, Lead, LeadMeta, LeadStatus } from "@/types";

interface LeadActionPanelProps {
  lead: Lead | null;
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

// Channel of last contact (interactions.type) — icon + label.
const CHANNEL_META: Record<string, { icon: string; label: string }> = {
  call: { icon: "📞", label: "Chiamata" },
  whatsapp: { icon: "💬", label: "WhatsApp" },
  email: { icon: "✉️", label: "Email" },
  meeting: { icon: "🤝", label: "Incontro" },
  note: { icon: "📝", label: "Nota" },
};
const CHANNELS = ["call", "whatsapp", "email", "meeting"] as const;

export default function LeadActionPanel({
  lead,
  onClose,
  onUpdate,
}: LeadActionPanelProps) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [price, setPrice] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [lastChannel, setLastChannel] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setNotes(lead?.notes ?? "");
    setPrice(lead && lead.value > 0 ? String(lead.value) : "");
  }, [lead]);

  // Load the most recent interaction to show the channel tag.
  useEffect(() => {
    if (!lead) {
      setLastChannel(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/interactions?leadId=${lead.id}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setLastChannel(j.success && j.data?.length ? j.data[0].type : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lead]);

  // Lock background scroll while the drawer is open + bring it into view
  // (it's portaled to body, so it's always viewport-fixed regardless of
  // how far down the list the selected lead was).
  useEffect(() => {
    if (!lead) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.scrollTo({ top: 0 });
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lead]);

  if (!lead) return null;

  const mobile = isMobilePhone(lead.phone);
  const action = nextBestAction(lead);
  const a = activityType(lead);
  const sm = LEAD_STATUS[lead.status];

  const messages = [
    { step: 1, label: "Step 1 · Primo contatto", text: generateStep1(lead) },
    { step: 2, label: "Step 2 · Conferma preview", text: generateStep2(lead) },
    { step: 3, label: "Step 3 · Consegna + prezzo", text: generateStep3(lead) },
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

  // Log a contact via a chosen channel → interactions + last_contact.
  async function logChannel(type: string) {
    if (!lead || busy) return;
    setBusy(true);
    try {
      await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: lead.id,
          type,
          content: `Contatto via ${CHANNEL_META[type]?.label ?? type}`,
        }),
      });
      setLastChannel(type);
    } catch {
      /* non-fatal */
    } finally {
      setBusy(false);
    }
    void patch({ last_contact: nowIso() });
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
      `Chiusura "${lead.name}"\n\nPrezzo finale concordato (€):`,
      lead.value > 0 ? String(lead.value) : "",
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

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-scrim/60 backdrop-blur-sm"
      />
      <motion.aside
        key="panel"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        className="fixed inset-y-0 right-0 z-[61] flex w-full flex-col border-l border-border bg-spectre-panel/98 backdrop-blur-2xl sm:max-w-[460px]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
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
              {lastChannel && CHANNEL_META[lastChannel] && (
                <span className="rounded-sm border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-text2">
                  {CHANNEL_META[lastChannel].icon} {CHANNEL_META[lastChannel].label}
                </span>
              )}
              <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.15em] text-accent">
                {lead.value > 0 ? formatCurrency(lead.value) : "Prezzo da definire"}
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
            className="shrink-0 rounded-sm p-1.5 text-spectre-muted transition-colors hover:bg-surface2 hover:text-spectre-magenta"
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
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm bg-[#25D366] px-3 font-mono text-[11px] font-semibold text-onaccent"
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
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm border border-border bg-surface2 px-3 font-mono text-[11px] text-spectre-muted"
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

          {/* Registra contatto (canale) */}
          <div className="mt-3">
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.2em] text-text2">
              Registra contatto
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={busy}
                  onClick={() => logChannel(c)}
                  className={cn(
                    "inline-flex min-h-[32px] items-center gap-1 rounded-sm border px-2.5 text-[11px] disabled:opacity-50",
                    lastChannel === c
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-text2 hover:border-accent/40",
                  )}
                >
                  {CHANNEL_META[c].icon} {CHANNEL_META[c].label}
                </button>
              ))}
            </div>
          </div>

          {/* Next best action */}
          <div
            className={cn(
              "mt-4 rounded-sm border p-3",
              action.urgent
                ? "border-danger/50 bg-danger/10"
                : "border-accent/40 bg-accent/10",
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
                  "mt-2.5 inline-flex min-h-[40px] items-center rounded-sm px-4 font-mono text-xs font-bold uppercase tracking-[0.12em] text-onaccent disabled:opacity-50",
                  action.urgent ? "bg-danger" : "bg-accent",
                )}
              >
                → {action.cta}
              </button>
            )}
          </div>

          {/* Prezzo proposto (manuale — nessun suggerimento automatico) */}
          <div className="mt-4">
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted">
              Prezzo proposto (€)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="es. 900"
                className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-sm text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-cyan/50 focus:outline-none"
              />
              {Math.max(0, Math.round(Number(price) || 0)) !== lead.value && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    patch({ value: Math.max(0, Math.round(Number(price) || 0)) })
                  }
                  className="shrink-0 rounded-sm border border-spectre-cyan/40 px-3 font-mono text-[11px] text-spectre-cyan disabled:opacity-50"
                >
                  Salva
                </button>
              )}
            </div>
            <p className="mt-1 font-mono text-[10px] text-spectre-muted/60">
              Lo metti tu. Finisce nel messaggio Step 3 e nella chiusura.
            </p>
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
              className="w-full resize-y rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12px] text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-cyan/50 focus:outline-none"
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

          {/* Cambia stato — sotto le note, con Scarta (niente scroll a fondo pagina) */}
          <div className="mt-4 border-t border-border pt-3">
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
                  className="inline-flex min-h-[34px] items-center rounded-sm border border-spectre-magenta/50 bg-spectre-magenta/10 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-spectre-magenta disabled:opacity-50"
                >
                  ✕ Scarta
                </button>
              )}
            </div>
          </div>

          {/* Message blocks (testi lunghi, in fondo) */}
          <div className="mt-4 flex flex-col gap-2">
            {messages.map((m) => {
              const primary = m.step === primaryStep;
              return (
                <details
                  key={m.step}
                  open={primary}
                  className={cn(
                    "group rounded-sm border bg-surface",
                    primary ? "border-spectre-cyan/40" : "border-border",
                  )}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-spectre-cyan">
                    {m.label}
                    <span className="text-spectre-muted/50 group-open:hidden">▾</span>
                  </summary>
                  <div className="px-3 pb-3">
                    <pre className="whitespace-pre-wrap break-words rounded-sm bg-surface p-2.5 font-sans text-[12px] leading-relaxed text-spectre-text/90">
                      {m.text}
                    </pre>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => sendStep(m.step)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm bg-[#25D366] px-3 font-mono text-[11px] font-semibold text-onaccent disabled:opacity-50"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {mobile ? "Apri WhatsApp" : "Copia per WA"}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyOnly(m.step)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-sm border border-border px-3 font-mono text-[11px] text-spectre-muted"
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
        </div>
      </motion.aside>
    </AnimatePresence>,
    document.body,
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
