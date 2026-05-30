"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileDown,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import LoadingGrid from "@/components/ui/spectre/LoadingGrid";
import AIMessage from "@/components/ui/spectre/AIMessage";
import { cn, formatCurrency } from "@/lib/utils";
import { useVoiceStore } from "@/lib/voice/store";
import type { ApiResponse, Lead, ProposalContent } from "@/types";

interface HandWizardProps {
  leads: Lead[];
}

const TONES = ["Professionale", "Aggressivo", "Soft", "Tecnico"] as const;

const BUNDLES = [
  { key: "ayrohub", label: "AyroHub" },
  { key: "ayrodesk24", label: "AyroDesk24" },
  { key: "ayromedia", label: "AyroMedia" },
] as const;

type BundleKey = (typeof BUNDLES)[number]["key"];

const inputClass =
  "w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-sm text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-cyan/50 focus:outline-none focus:ring-1 focus:ring-spectre-cyan/40";
const labelClass =
  "mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted";

const STEP_LABELS = ["Target", "Intento", "Output"];

export default function HandWizard({ leads }: HandWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [company, setCompany] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const [intent, setIntent] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("Professionale");
  const [bundles, setBundles] = useState<Record<BundleKey, boolean>>({
    ayrohub: false,
    ayrodesk24: false,
    ayromedia: false,
  });

  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<ProposalContent | null>(null);
  const [activeTier, setActiveTier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const pendingAction = useVoiceStore((s) => s.pendingAction);
  const consumeAction = useVoiceStore((s) => s.consumeAction);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return leads
      .filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.company.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query, leads]);

  const flashMsg = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 1500);
  };

  const pickLead = (lead: Lead) => {
    setLeadName(lead.name);
    setCompany(lead.company);
    setSelectedLeadId(lead.id);
    setQuery(lead.company);
    setShowSuggestions(false);
  };

  // Voice: "genera proposta per [nome]" → preselect lead, jump to step 2.
  useEffect(() => {
    if (
      !pendingAction ||
      pendingAction.module !== "hand" ||
      pendingAction.kind !== "generate"
    )
      return;
    const name = String(pendingAction.payload.leadName ?? "").trim();
    consumeAction();
    if (!name) return;
    const lower = name.toLowerCase();
    const lead = leads.find(
      (l) =>
        l.name.toLowerCase().includes(lower) ||
        l.company.toLowerCase().includes(lower),
    );
    if (lead) {
      setLeadName(lead.name);
      setCompany(lead.company);
      setSelectedLeadId(lead.id);
      setQuery(lead.company);
      setShowSuggestions(false);
    } else {
      setLeadName(name);
      setCompany(name);
      setQuery(name);
    }
    setStep(2);
  }, [pendingAction, consumeAction, leads]);

  const generate = async () => {
    if (!company.trim()) {
      setError("Indica almeno l'azienda target.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/hand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_name: leadName.trim(),
          company: company.trim(),
          intent: intent.trim(),
          tone,
          bundle_ayrohub: bundles.ayrohub,
          bundle_ayrodesk24: bundles.ayrodesk24,
          bundle_ayromedia: bundles.ayromedia,
        }),
      });
      const json: ApiResponse<ProposalContent> = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error ?? "Generazione fallita.");
      }
      setProposal(json.data);
      setActiveTier(json.data.pricing[0]?.name ?? "");
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const copyEmail = async () => {
    if (!proposal) return;
    await navigator.clipboard.writeText(
      `${proposal.email_subject}\n\n${proposal.email_body}`,
    );
    flashMsg("EMAIL COPIATA");
  };

  const save = async () => {
    if (!proposal) return;
    if (!selectedLeadId) {
      setError("Collega un lead esistente (step 1) per salvare la proposta.");
      return;
    }
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: selectedLeadId, content: proposal }),
      });
      const json: ApiResponse<unknown> = await res.json();
      if (!json.success) throw new Error(json.error ?? "Salvataggio fallito.");
      flashMsg("PROPOSTA SALVATA");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const exportPdf = async () => {
    if (!proposal) return;
    const { pdf } = await import("@react-pdf/renderer");
    const { default: ProposalPDF } = await import("./ProposalPDF");
    const blob = await pdf(
      <ProposalPDF proposal={proposal} company={company} />,
    ).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proposta-${company.trim().replace(/\s+/g, "-").toLowerCase() || "ayromex"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flashMsg("PDF ESPORTATO");
  };

  const reset = () => {
    setStep(1);
    setQuery("");
    setLeadName("");
    setCompany("");
    setSelectedLeadId(null);
    setIntent("");
    setTone("Professionale");
    setBundles({ ayrohub: false, ayrodesk24: false, ayromedia: false });
    setProposal(null);
    setActiveTier("");
    setError(null);
  };

  const activeTierData =
    proposal?.pricing.find((t) => t.name === activeTier) ??
    proposal?.pricing[0];

  return (
    <div className="mt-4">
      {/* Step indicator */}
      <div className="mb-4 flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-sm border font-mono text-[11px]",
                  active &&
                    "border-spectre-cyan bg-spectre-cyan/10 text-spectre-cyan shadow-neon-cyan",
                  done && "border-spectre-green/50 text-spectre-green",
                  !active &&
                    !done &&
                    "border-border text-spectre-muted",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : n}
              </span>
              <span
                className={cn(
                  "hidden font-mono text-[11px] uppercase tracking-[0.2em] sm:inline",
                  active ? "text-spectre-text" : "text-spectre-muted",
                )}
              >
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <span className="mx-1 h-px w-4 bg-spectre-cyan/20 sm:w-6" />
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <GlassCard corners className="p-6">
              <LoadingGrid label="HAND STA SCRIVENDO" />
            </GlassCard>
          </motion.div>
        ) : step === 1 ? (
          <motion.div key="s1" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
            <GlassCard corners className="p-5">
              <div className="relative">
                <label className={labelClass} htmlFor="hw-search">
                  Cerca un lead esistente
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-spectre-muted" />
                  <input
                    id="hw-search"
                    className={cn(inputClass, "pl-9")}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder="Nome o azienda…"
                    autoComplete="off"
                  />
                </div>
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-sm border border-border bg-spectre-panel/95 backdrop-blur-xl">
                    {suggestions.map((lead) => (
                      <li key={lead.id}>
                        <button
                          type="button"
                          onClick={() => pickLead(lead)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-spectre-cyan/10"
                        >
                          <span className="truncate font-display text-sm text-spectre-text">
                            {lead.name}
                          </span>
                          <span className="shrink-0 truncate font-mono text-[10px] text-spectre-muted">
                            {lead.company}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="hw-name">
                    Nome contatto
                  </label>
                  <input
                    id="hw-name"
                    className={inputClass}
                    value={leadName}
                    onChange={(e) => {
                      setLeadName(e.target.value);
                      setSelectedLeadId(null);
                    }}
                    placeholder="Mario Rossi"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="hw-company">
                    Azienda *
                  </label>
                  <input
                    id="hw-company"
                    className={inputClass}
                    value={company}
                    onChange={(e) => {
                      setCompany(e.target.value);
                      setSelectedLeadId(null);
                    }}
                    placeholder="Studio Rossi"
                  />
                </div>
              </div>

              {selectedLeadId && (
                <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-spectre-green">
                  <Check className="h-3 w-3" /> lead collegato
                </p>
              )}

              {error && (
                <p className="mt-3 font-mono text-[11px] text-spectre-magenta">
                  {error}
                </p>
              )}

              <div className="mt-5 flex justify-end">
                <NeonButton
                  variant="cyan"
                  filled
                  size="sm"
                  onClick={() => {
                    if (!company.trim()) {
                      setError("Indica almeno l'azienda target.");
                      return;
                    }
                    setError(null);
                    setStep(2);
                  }}
                >
                  Avanti <ChevronRight className="h-3.5 w-3.5" />
                </NeonButton>
              </div>
            </GlassCard>
          </motion.div>
        ) : step === 2 ? (
          <motion.div key="s2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
            <GlassCard corners className="p-5">
              <div>
                <label className={labelClass} htmlFor="hw-intent">
                  Obiettivo / pain point
                </label>
                <textarea
                  id="hw-intent"
                  rows={4}
                  className={cn(inputClass, "resize-none")}
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="Es. perdono prenotazioni fuori orario e gestiscono i richiami a mano…"
                />
              </div>

              <div className="mt-4">
                <span className={labelClass}>Tono</span>
                <div className="flex flex-wrap gap-2">
                  {TONES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTone(t)}
                      className={cn(
                        "rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-all",
                        tone === t
                          ? "border-spectre-cyan bg-spectre-cyan/10 text-spectre-cyan shadow-neon-cyan"
                          : "border-border text-spectre-muted hover:border-spectre-cyan/40",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <span className={labelClass}>Bundle inclusi</span>
                <div className="flex flex-wrap gap-2">
                  {BUNDLES.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setBundles((prev) => ({ ...prev, [key]: !prev[key] }))
                      }
                      className={cn(
                        "rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-all",
                        bundles[key]
                          ? "border-spectre-magenta bg-spectre-magenta/10 text-spectre-magenta shadow-neon-magenta"
                          : "border-border text-spectre-muted hover:border-spectre-cyan/40",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p className="mt-3 font-mono text-[11px] text-spectre-magenta">
                  {error}
                </p>
              )}

              <div className="mt-5 flex justify-between">
                <NeonButton variant="ghost" size="sm" onClick={() => setStep(1)}>
                  <ChevronLeft className="h-3.5 w-3.5" /> Indietro
                </NeonButton>
                <NeonButton variant="magenta" filled size="sm" onClick={generate}>
                  Genera proposta <ChevronRight className="h-3.5 w-3.5" />
                </NeonButton>
              </div>
            </GlassCard>
          </motion.div>
        ) : (
          proposal &&
          activeTierData && (
            <motion.div key="s3" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <GlassCard corners glow="amber" className="p-5">
                <h2 className="font-display text-lg font-bold text-spectre-text">
                  {proposal.title}
                </h2>

                <div className="mt-4 space-y-3">
                  {proposal.sections.map((s) => (
                    <div key={s.heading}>
                      <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-spectre-cyan">
                        {s.heading}
                      </h3>
                      <p className="mt-1 whitespace-pre-wrap font-ui text-sm leading-relaxed text-spectre-text/90">
                        {s.body}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Pricing tabs */}
                <div className="mt-5">
                  <div className="flex gap-2">
                    {proposal.pricing.map((tier) => (
                      <button
                        key={tier.name}
                        type="button"
                        onClick={() => setActiveTier(tier.name)}
                        className={cn(
                          "flex-1 rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition-all",
                          activeTier === tier.name
                            ? "border-spectre-amber bg-spectre-amber/10 text-spectre-amber shadow-neon-amber"
                            : "border-border text-spectre-muted hover:border-spectre-cyan/40",
                        )}
                      >
                        {tier.name}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 rounded-sm border border-spectre-amber/20 bg-surface p-4">
                    <p className="font-mono text-2xl font-bold text-spectre-amber">
                      {formatCurrency(activeTierData.price)}
                    </p>
                    <p className="mt-1 font-ui text-sm text-spectre-text/80">
                      {activeTierData.description}
                    </p>
                  </div>
                </div>

                {/* Email */}
                <div className="mt-5">
                  <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-spectre-cyan">
                    Email · {proposal.email_subject}
                  </h3>
                  <AIMessage text={proposal.email_body} />
                </div>

                {/* Follow-up script */}
                <div className="mt-4">
                  <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-spectre-cyan">
                    Script follow-up
                  </h3>
                  <p className="rounded-sm border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-spectre-text/80">
                    {proposal.followup_script}
                  </p>
                </div>

                {error && (
                  <p className="mt-3 font-mono text-[11px] text-spectre-magenta">
                    {error}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <NeonButton variant="amber" size="sm" onClick={exportPdf}>
                    <FileDown className="h-3.5 w-3.5" /> Esporta PDF
                  </NeonButton>
                  <NeonButton variant="cyan" size="sm" onClick={copyEmail}>
                    <Copy className="h-3.5 w-3.5" /> Copia email
                  </NeonButton>
                  <NeonButton variant="green" size="sm" onClick={save}>
                    <Save className="h-3.5 w-3.5" /> Salva
                  </NeonButton>
                  <NeonButton variant="ghost" size="sm" onClick={reset}>
                    <RefreshCw className="h-3.5 w-3.5" /> Nuova
                  </NeonButton>
                  {flash && (
                    <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-spectre-green">
                      <Check className="h-3 w-3" /> {flash}
                    </span>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}
