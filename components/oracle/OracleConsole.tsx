"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Sparkles, Target, Zap } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import LoadingGrid from "@/components/ui/spectre/LoadingGrid";
import TypingText from "@/components/ui/spectre/TypingText";
import { useCountUp } from "@/hooks/useCountUp";
import { LEAD_STATUS, probabilityHex } from "@/lib/constants";
import { useVoiceStore } from "@/lib/voice/store";
import { clamp, formatCurrency } from "@/lib/utils";
import type { ApiResponse, Lead, OraclePrediction } from "@/types";

// ============================================================
// SPECTRE ORACLE — close-probability simulator.
// Left deck (40%): lead picker, price + follow-up sliders,
// bundle toggles, SIMULA SCENARIO. Right panel (60%): animated
// probability read-out, 3 comparative scenarios, AI insight +
// recommendation (typed), urgency badge.
// ============================================================

interface OracleConsoleProps {
  leads: Lead[];
}

const BUNDLES = [
  { key: "ayrohub", label: "AyroHub" },
  { key: "ayrodesk24", label: "AyroDesk24" },
  { key: "ayromedia", label: "AyroMedia" },
] as const;

type BundleKey = (typeof BUNDLES)[number]["key"];

const URGENCY: Record<
  OraclePrediction["urgency_level"],
  { label: string; cls: string }
> = {
  low: {
    label: "Bassa urgenza",
    cls: "border-spectre-green/40 text-spectre-green bg-spectre-green/10",
  },
  medium: {
    label: "Media urgenza",
    cls: "border-spectre-amber/40 text-spectre-amber bg-spectre-amber/10",
  },
  high: {
    label: "Alta urgenza",
    cls: "border-spectre-magenta/40 text-spectre-magenta bg-spectre-magenta/10",
  },
};

const PRICE_MIN = 500;
const PRICE_MAX = 50000;

function snapPrice(v: number): number {
  return clamp(Math.round(v / 500) * 500, PRICE_MIN, PRICE_MAX);
}

const inputClass =
  "w-full rounded-sm border border-spectre-amber/20 bg-black/50 px-3 py-2 font-mono text-sm text-spectre-text focus:border-spectre-amber/50 focus:outline-none";
const labelClass =
  "mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted";

export default function OracleConsole({ leads }: OracleConsoleProps) {
  const [leadId, setLeadId] = useState(leads[0]?.id ?? "");
  const [price, setPrice] = useState(
    leads[0] ? snapPrice(leads[0].value) : 5000,
  );
  const [days, setDays] = useState(7);
  const [bundles, setBundles] = useState<Record<BundleKey, boolean>>({
    ayrohub: false,
    ayrodesk24: false,
    ayromedia: false,
  });
  const [loading, setLoading] = useState(false);
  const [prediction, setPrediction] = useState<OraclePrediction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingAction = useVoiceStore((s) => s.pendingAction);
  const consumeAction = useVoiceStore((s) => s.consumeAction);
  const setReadable = useVoiceStore((s) => s.setReadable);
  const [autoSim, setAutoSim] = useState(0);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === leadId) ?? null,
    [leads, leadId],
  );

  const animatedProb = useCountUp(prediction?.probability_main ?? 0, 1100);
  const probColor = probabilityHex(prediction?.probability_main ?? 0);

  const pickLead = (id: string) => {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (lead) setPrice(snapPrice(lead.value));
  };

  const toggleBundle = (key: BundleKey) =>
    setBundles((b) => ({ ...b, [key]: !b[key] }));

  const simulate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/oracle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: selectedLead?.id ?? "",
          lead_name: selectedLead?.name ?? "",
          company: selectedLead?.company ?? "",
          value: selectedLead?.value ?? price,
          status: selectedLead?.status ?? "replied",
          proposed_price: price,
          days_to_followup: days,
          bundle_ayrohub: bundles.ayrohub,
          bundle_ayrodesk24: bundles.ayrodesk24,
          bundle_ayromedia: bundles.ayromedia,
        }),
      });
      const json: ApiResponse<OraclePrediction> = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error ?? "Simulazione fallita.");
      }
      setPrediction(json.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedLead, price, days, bundles]);

  // Voice: "simula scenario per [nome]" → pick lead, then auto-simulate.
  useEffect(() => {
    if (
      !pendingAction ||
      pendingAction.module !== "oracle" ||
      pendingAction.kind !== "simulate"
    )
      return;
    const name = String(pendingAction.payload.leadName ?? "").toLowerCase();
    consumeAction();
    if (!name) return;
    const lead = leads.find(
      (l) =>
        l.name.toLowerCase().includes(name) ||
        l.company.toLowerCase().includes(name),
    );
    if (lead) {
      setLeadId(lead.id);
      setPrice(snapPrice(lead.value));
      setAutoSim((n) => n + 1);
    }
  }, [pendingAction, consumeAction, leads]);

  useEffect(() => {
    if (autoSim === 0) return;
    void simulate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSim]);

  // Register insight for the "leggi insight" voice command.
  useEffect(() => {
    if (prediction) {
      setReadable({
        section: "insight",
        text: `${prediction.insight}. Raccomandazione: ${prediction.recommendation}`,
      });
    }
  }, [prediction, setReadable]);

  useEffect(() => () => setReadable(null), [setReadable]);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]">
      {/* ---------- LEFT DECK ---------- */}
      <GlassCard corners className="flex flex-col gap-5 p-5" glow="amber">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-spectre-amber" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-muted">
            Parametri scenario
          </span>
        </div>

        <div>
          <label className={labelClass} htmlFor="or-lead">
            Lead
          </label>
          {leads.length > 0 ? (
            <select
              id="or-lead"
              className={inputClass}
              value={leadId}
              onChange={(e) => pickLead(e.target.value)}
            >
              {leads.map((l) => (
                <option key={l.id} value={l.id} className="bg-spectre-panel">
                  {l.company} — {l.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="font-mono text-xs text-spectre-muted">
              Nessun lead disponibile.
            </p>
          )}
          {selectedLead && (
            <div className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-spectre-muted">
              <span
                className={`rounded-sm border px-1.5 py-0.5 ${LEAD_STATUS[selectedLead.status].badge}`}
              >
                {LEAD_STATUS[selectedLead.status].label}
              </span>
              <span>Valore {formatCurrency(selectedLead.value)}</span>
            </div>
          )}
        </div>

        {/* Price slider */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className={labelClass + " mb-0"}>Prezzo proposto</span>
            <span className="font-mono text-sm font-bold text-spectre-amber">
              {formatCurrency(price)}
            </span>
          </div>
          <input
            type="range"
            min={PRICE_MIN}
            max={PRICE_MAX}
            step={500}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="w-full cursor-pointer accent-spectre-amber"
            style={{ accentColor: "#ffbe0b" }}
          />
          <div className="mt-1 flex justify-between font-mono text-[9px] text-spectre-muted/60">
            <span>{formatCurrency(PRICE_MIN)}</span>
            <span>{formatCurrency(PRICE_MAX)}</span>
          </div>
        </div>

        {/* Days slider */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className={labelClass + " mb-0"}>Follow-up tra</span>
            <span className="font-mono text-sm font-bold text-spectre-cyan">
              {days} {days === 1 ? "giorno" : "giorni"}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full cursor-pointer"
            style={{ accentColor: "#00f0ff" }}
          />
          <div className="mt-1 flex justify-between font-mono text-[9px] text-spectre-muted/60">
            <span>Oggi</span>
            <span>30 giorni</span>
          </div>
        </div>

        {/* Bundle toggles */}
        <div>
          <span className={labelClass}>Bundle inclusi</span>
          <div className="flex flex-wrap gap-2">
            {BUNDLES.map((b) => {
              const active = bundles[b.key];
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => toggleBundle(b.key)}
                  className={`rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.15em] transition-all ${
                    active
                      ? "border-spectre-amber bg-spectre-amber/15 text-spectre-amber shadow-neon-amber"
                      : "border-spectre-amber/20 text-spectre-muted hover:border-spectre-amber/40 hover:text-spectre-text"
                  }`}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p className="font-mono text-[11px] text-spectre-magenta">{error}</p>
        )}

        <NeonButton
          variant="amber"
          filled
          size="lg"
          onClick={simulate}
          disabled={loading || leads.length === 0}
          className="mt-auto w-full"
        >
          <Zap className="h-4 w-4" />
          {loading ? "Simulazione…" : "Simula scenario"}
        </NeonButton>
      </GlassCard>

      {/* ---------- RIGHT: PREDICTION ---------- */}
      <GlassCard corners className="min-w-0 p-6" glow="amber">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full min-h-[420px] items-center justify-center"
            >
              <LoadingGrid label="ORACLE CALCOLA" />
            </motion.div>
          ) : prediction ? (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-6"
            >
              {/* Big probability */}
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-muted">
                    Probabilità di chiusura
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span
                      className="font-mono font-bold leading-none"
                      style={{ fontSize: 72, color: probColor }}
                    >
                      {Math.round(animatedProb)}
                    </span>
                    <span
                      className="font-mono text-2xl font-bold"
                      style={{ color: probColor }}
                    >
                      %
                    </span>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted">
                    Confidenza {Math.round(prediction.confidence * 100)}%
                  </span>
                </div>
                <span
                  className={`rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] ${URGENCY[prediction.urgency_level].cls}`}
                >
                  {URGENCY[prediction.urgency_level].label}
                </span>
              </div>

              {/* Scenarios */}
              <div className="flex flex-col gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-muted">
                  Scenari comparativi
                </span>
                {prediction.scenarios.map((s, i) => {
                  const hex = probabilityHex(s.probability);
                  return (
                    <div key={i}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono text-xs text-spectre-text">
                          {s.label}
                        </span>
                        <span className="flex items-center gap-2 font-mono text-xs">
                          <span style={{ color: hex }}>
                            {Math.round(s.probability)}%
                          </span>
                          {s.change !== 0 && (
                            <span
                              className={
                                s.change > 0
                                  ? "text-spectre-green"
                                  : "text-spectre-magenta"
                              }
                            >
                              {s.change > 0 ? "+" : ""}
                              {Math.round(s.change)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                        <motion.div
                          className="h-full rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${clamp(s.probability, 0, 100)}%` }}
                          transition={{ duration: 0.7, delay: 0.15 + i * 0.12, ease: "easeOut" }}
                          style={{ backgroundColor: hex, boxShadow: `0 0 8px ${hex}` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Insight + recommendation */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-spectre-cyan/20 bg-spectre-cyan/[0.03] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Activity className="h-3.5 w-3.5 text-spectre-cyan" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-cyan">
                      Insight
                    </span>
                  </div>
                  <TypingText
                    key={`ins-${prediction.insight}`}
                    text={prediction.insight}
                    speed={16}
                    className="text-sm leading-relaxed text-spectre-text"
                  />
                </div>
                <div className="rounded-md border border-spectre-amber/20 bg-spectre-amber/[0.03] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-spectre-amber" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-amber">
                      Raccomandazione
                    </span>
                  </div>
                  <TypingText
                    key={`rec-${prediction.recommendation}`}
                    text={prediction.recommendation}
                    speed={16}
                    startDelay={350}
                    className="text-sm leading-relaxed text-spectre-text"
                  />
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-center"
            >
              <Target className="h-10 w-10 text-spectre-amber/40" />
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-spectre-muted">
                Nessuna previsione
              </p>
              <p className="max-w-sm font-mono text-[11px] text-spectre-muted/70">
                Imposta prezzo, follow-up e bundle, poi avvia la simulazione:
                ORACLE calcola la probabilità di chiusura e tre scenari
                alternativi.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </div>
  );
}
