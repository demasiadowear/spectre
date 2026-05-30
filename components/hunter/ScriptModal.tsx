"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, FileText, Phone, X } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import LoadingGrid from "@/components/ui/spectre/LoadingGrid";
import { useVoiceStore } from "@/lib/voice/store";
import type { ApiResponse } from "@/types";
import type { ColdCallScript, ScoredLead } from "@/types/hunter";

interface ScriptModalProps {
  open: boolean;
  lead: ScoredLead | null;
  category: string;
  onClose: () => void;
}

function buildFullText(s: ColdCallScript): string {
  return [
    `APERTURA\n${s.opening}`,
    `RAPPORT\n${s.rapport}`,
    `PAIN POINTS\n- ${s.pain_points.join("\n- ")}`,
    `SOLUZIONE AYROMEX\n${s.solution}`,
    `SOCIAL PROOF\n${s.social_proof}`,
    `PREZZO\n${s.price_anchor}`,
    `CHIUSURA\n${s.closing}`,
    `OBIEZIONI\n${s.objections
      .map((o) => `> ${o.objection}\n${o.response}`)
      .join("\n\n")}`,
  ].join("\n\n");
}

function Section({
  label,
  accent,
  children,
}: {
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-sm border border-white/10 bg-black/30 p-4"
      style={{ borderLeft: `2px solid ${accent}` }}
    >
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-spectre-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

export default function ScriptModal({
  open,
  lead,
  category,
  onClose,
}: ScriptModalProps) {
  const [script, setScript] = useState<ColdCallScript | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"full" | "opening" | null>(null);
  const setReadable = useVoiceStore((s) => s.setReadable);

  // Fetch the script whenever the modal opens for a lead.
  useEffect(() => {
    if (!open || !lead) return;
    const controller = new AbortController();
    setScript(null);
    setError(null);
    setCopied(null);
    setLoading(true);
    fetch("/api/ai/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead, category }),
      signal: controller.signal,
    })
      .then((r) => r.json() as Promise<ApiResponse<ColdCallScript>>)
      .then((json) => {
        if (json.success && json.data) {
          setScript(json.data);
          // Register for the "leggi script" voice command.
          setReadable({ section: "script", text: buildFullText(json.data) });
        } else {
          setError(json.error || "Generazione script fallita.");
        }
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError")
          setError("Generazione script fallita.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, lead, category, setReadable]);

  // Clear readable when the modal is closed / unmounted.
  useEffect(() => {
    if (!open) setReadable(null);
    return () => setReadable(null);
  }, [open, setReadable]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const copy = useCallback(async (text: string, which: "full" | "opening") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Copia non riuscita.");
    }
  }, []);

  return (
    <AnimatePresence>
      {open && lead && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] w-full max-w-2xl"
          >
            <GlassCard
              corners
              glow="cyan"
              className="flex max-h-[88vh] flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-start justify-between border-b border-white/10 p-5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-display text-base font-bold text-spectre-text">
                    <FileText className="h-4 w-4 text-spectre-cyan" strokeWidth={1.5} />
                    <span className="truncate">{lead.name}</span>
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.2em] text-spectre-muted">
                    Cold call script · {category}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Chiudi"
                  className="text-spectre-muted transition hover:text-spectre-magenta"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5">
                {loading && (
                  <div className="flex h-48 items-center justify-center">
                    <LoadingGrid label="SPECTRE SCRIVE" />
                  </div>
                )}

                {error && !loading && (
                  <p className="py-8 text-center font-mono text-xs uppercase tracking-[0.2em] text-spectre-magenta">
                    {error}
                  </p>
                )}

                {script && !loading && (
                  <div className="flex flex-col gap-3">
                    <Section label="Apertura" accent="#00f0ff">
                      <p className="text-sm leading-relaxed text-spectre-text">
                        {script.opening}
                      </p>
                    </Section>

                    <Section label="Rapport & Pain Points" accent="#ff006e">
                      <p className="text-sm leading-relaxed text-spectre-text">
                        {script.rapport}
                      </p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {script.pain_points.map((p, i) => (
                          <li
                            key={i}
                            className="flex gap-2 text-sm leading-relaxed text-spectre-muted"
                          >
                            <span className="text-spectre-magenta">▸</span>
                            {p}
                          </li>
                        ))}
                      </ul>
                    </Section>

                    <Section label="Soluzione AYROMEX" accent="#38b000">
                      <p className="text-sm leading-relaxed text-spectre-text">
                        {script.solution}
                      </p>
                    </Section>

                    <Section label="Social Proof" accent="#ffbe0b">
                      <p className="text-sm italic leading-relaxed text-spectre-muted">
                        {script.social_proof}
                      </p>
                    </Section>

                    <Section label="Prezzo" accent="#00f0ff">
                      <p className="font-mono text-sm font-bold leading-relaxed text-spectre-cyan">
                        {script.price_anchor}
                      </p>
                    </Section>

                    <Section label="Chiusura" accent="#ff006e">
                      <p className="text-sm leading-relaxed text-spectre-text">
                        {script.closing}
                      </p>
                    </Section>

                    <Section label="Obiezioni" accent="#a855f7">
                      <ul className="flex flex-col gap-3">
                        {script.objections.map((o, i) => (
                          <li key={i} className="flex flex-col gap-0.5">
                            <span className="font-mono text-xs font-bold text-spectre-magenta">
                              “{o.objection}”
                            </span>
                            <span className="text-sm leading-relaxed text-spectre-text">
                              {o.response}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  </div>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex flex-wrap items-center gap-2 border-t border-white/10 p-4">
                <NeonButton
                  variant="cyan"
                  size="sm"
                  disabled={!script}
                  onClick={() => script && copy(buildFullText(script), "full")}
                >
                  {copied === "full" ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                  {copied === "full" ? "Copiato" : "Copia tutto"}
                </NeonButton>
                <NeonButton
                  variant="ghost"
                  size="sm"
                  disabled={!script}
                  onClick={() => script && copy(script.opening, "opening")}
                >
                  {copied === "opening" ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                  {copied === "opening" ? "Copiato" : "Copia apertura"}
                </NeonButton>

                <span className="flex-1" />

                {lead.phone && (
                  <a href={`tel:${lead.phone.replace(/\s+/g, "")}`}>
                    <NeonButton variant="magenta" size="sm" filled>
                      <Phone className="h-3.5 w-3.5" strokeWidth={1.5} />
                      Chiama ora
                    </NeonButton>
                  </a>
                )}
                <NeonButton variant="ghost" size="sm" onClick={onClose}>
                  Chiudi
                </NeonButton>
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
