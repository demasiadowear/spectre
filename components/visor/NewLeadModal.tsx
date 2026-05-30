"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { LEAD_STATUS, PIPELINE_ORDER } from "@/lib/constants";
import type { ApiResponse, Lead, LeadSource, LeadStatus } from "@/types";

interface NewLeadModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (lead: Lead) => void;
}

const SOURCES: { value: LeadSource; label: string }[] = [
  { value: "maps", label: "Google Maps" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "referral", label: "Referral" },
  { value: "cold", label: "Cold" },
];

const inputClass =
  "w-full rounded-sm border border-spectre-cyan/20 bg-black/50 px-3 py-2 font-mono text-sm text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-cyan/50 focus:outline-none focus:ring-1 focus:ring-spectre-cyan/40";
const labelClass =
  "mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted";

export default function NewLeadModal({
  open,
  onClose,
  onCreated,
}: NewLeadModalProps) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<LeadStatus>("cold");
  const [source, setSource] = useState<LeadSource>("cold");
  const [nextAction, setNextAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setCompany("");
    setEmail("");
    setPhone("");
    setValue("");
    setStatus("cold");
    setSource("cold");
    setNextAction("");
    setError(null);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !company.trim()) {
      setError("Nome e azienda sono obbligatori.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          company: company.trim(),
          email: email.trim(),
          phone: phone.trim(),
          value: Number(value) || 0,
          status,
          source,
          next_action: nextAction.trim(),
        }),
      });
      const json: ApiResponse<Lead> = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error ?? "Creazione fallita.");
      }
      onCreated(json.data);
      reset();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-sm border border-spectre-cyan/25 bg-spectre-panel/95 p-6 shadow-glass"
          >
            <button
              type="button"
              onClick={close}
              aria-label="Chiudi"
              className="absolute right-4 top-4 text-spectre-muted transition-colors hover:text-spectre-magenta"
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="mb-5 font-display text-lg font-bold text-spectre-text">
              Nuovo lead
            </h2>

            <form onSubmit={submit} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="nl-name">
                    Nome *
                  </label>
                  <input
                    id="nl-name"
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Mario Rossi"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="nl-company">
                    Azienda *
                  </label>
                  <input
                    id="nl-company"
                    className={inputClass}
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Studio Rossi"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="nl-email">
                    Email
                  </label>
                  <input
                    id="nl-email"
                    type="email"
                    className={inputClass}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="mario@studio.it"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="nl-phone">
                    Telefono
                  </label>
                  <input
                    id="nl-phone"
                    className={inputClass}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+39 ..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="nl-value">
                    Valore (€)
                  </label>
                  <input
                    id="nl-value"
                    inputMode="numeric"
                    className={inputClass}
                    value={value}
                    onChange={(e) =>
                      setValue(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="5000"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="nl-source">
                    Fonte
                  </label>
                  <select
                    id="nl-source"
                    className={inputClass}
                    value={source}
                    onChange={(e) => setSource(e.target.value as LeadSource)}
                  >
                    {SOURCES.map((s) => (
                      <option key={s.value} value={s.value} className="bg-spectre-panel">
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="nl-status">
                  Stato pipeline
                </label>
                <select
                  id="nl-status"
                  className={inputClass}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as LeadStatus)}
                >
                  {PIPELINE_ORDER.map((s) => (
                    <option key={s} value={s} className="bg-spectre-panel">
                      {LEAD_STATUS[s].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass} htmlFor="nl-action">
                  Prossima azione
                </label>
                <input
                  id="nl-action"
                  className={inputClass}
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                  placeholder="Chiamata di follow-up"
                />
              </div>

              {error && (
                <p className="font-mono text-[11px] text-spectre-magenta">
                  {error}
                </p>
              )}

              <div className="mt-2 flex justify-end gap-2">
                <NeonButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={close}
                  disabled={submitting}
                >
                  Annulla
                </NeonButton>
                <NeonButton
                  type="submit"
                  variant="cyan"
                  filled
                  size="sm"
                  disabled={submitting}
                >
                  {submitting ? "Creazione…" : "Crea lead"}
                </NeonButton>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
