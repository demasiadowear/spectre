"use client";

import { useEffect, useMemo, useState } from "react";
import { LEAD_STATUS, PIPELINE_ORDER } from "@/lib/constants";
import { clamp, formatCurrency } from "@/lib/utils";
import type { Lead } from "@/types";

interface ForecastBoardProps {
  initialLeads: Lead[];
}

const TARGET_KEY = "spectre-forecast-target";

export default function ForecastBoard({ initialLeads }: ForecastBoardProps) {
  const [leads] = useState<Lead[]>(initialLeads);
  const [target, setTarget] = useState(5000);

  useEffect(() => {
    const saved = Number(localStorage.getItem(TARGET_KEY));
    if (saved > 0) setTarget(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem(TARGET_KEY, String(target));
  }, [target]);

  const f = useMemo(() => {
    const open = leads.filter((l) => l.status !== "closed" && l.status !== "lost");
    const cash = leads
      .filter((l) => l.status === "closed")
      .reduce((s, l) => s + (l.meta.closed_price ?? l.value), 0);

    let realista = 0;
    let pessimista = 0;
    let ottimista = 0;
    for (const l of open) {
      const p = clamp(l.probability, 0, 100) / 100;
      realista += l.value * p;
      pessimista += l.value * p * 0.55;
      ottimista += l.value * Math.min(1, p + 0.25);
    }
    return {
      cash,
      open,
      openValue: open.reduce((s, l) => s + l.value, 0),
      realista: Math.round(realista),
      pessimista: Math.round(pessimista),
      ottimista: Math.round(ottimista),
    };
  }, [leads]);

  const byStage = useMemo(() => {
    return PIPELINE_ORDER.filter((s) => s !== "closed").map((s) => {
      const items = leads.filter((l) => l.status === s);
      return {
        status: s,
        count: items.length,
        value: items.reduce((sum, l) => sum + l.value, 0),
      };
    });
  }, [leads]);

  const projected = f.cash + f.realista;
  const gap = Math.max(0, target - projected);
  const targetPct = target > 0 ? Math.min(100, Math.round((projected / target) * 100)) : 0;

  const scenarios = [
    { label: "Pessimista", value: f.pessimista, hex: "#52525b", note: "solo deal molto probabili" },
    { label: "Realista", value: f.realista, hex: "#00f0ff", note: "pipeline pesata per probabilità" },
    { label: "Ottimista", value: f.ottimista, hex: "#38b000", note: "se spingi le chiusure" },
  ];
  const maxScenario = Math.max(1, f.ottimista, target);

  return (
    <div className="flex flex-col gap-4">
      {/* Top row: cash + projected + target */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-sm border border-spectre-green/40 bg-spectre-green/5 p-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-muted">
            Cash incassato
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-spectre-green">
            {formatCurrency(f.cash)}
          </p>
        </div>
        <div className="rounded-sm border border-spectre-cyan/30 bg-spectre-cyan/5 p-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-muted">
            Proiezione (cash + realista)
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-spectre-cyan">
            {formatCurrency(projected)}
          </p>
        </div>
        <div className="rounded-sm border border-spectre-amber/30 bg-spectre-amber/5 p-4">
          <label className="font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-muted">
            Target periodo
          </label>
          <div className="mt-1 flex items-center gap-1">
            <span className="font-display text-2xl font-bold text-spectre-amber">€</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={500}
              value={target}
              onChange={(e) => setTarget(Math.max(0, Number(e.target.value)))}
              className="w-full bg-transparent font-display text-2xl font-bold text-spectre-amber focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Target progress */}
      <div className="rounded-sm border border-spectre-cyan/15 bg-black/40 p-4">
        <div className="mb-2 flex items-center justify-between font-mono text-[11px]">
          <span className="text-spectre-muted">
            {gap > 0 ? `Mancano ${formatCurrency(gap)} al target` : "🎉 Target raggiunto"}
          </span>
          <span className="text-spectre-text">{targetPct}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${targetPct}%`,
              backgroundColor: gap > 0 ? "#00f0ff" : "#38b000",
              boxShadow: `0 0 8px ${gap > 0 ? "#00f0ff" : "#38b000"}`,
            }}
          />
        </div>
      </div>

      {/* Scenarios */}
      <div className="rounded-sm border border-spectre-cyan/15 bg-black/40 p-4">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-spectre-muted">
          Scenari di chiusura pipeline
        </p>
        <div className="flex flex-col gap-3">
          {scenarios.map((s) => (
            <div key={s.label}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="font-mono text-xs text-spectre-text">{s.label}</span>
                <span className="font-mono text-sm font-bold" style={{ color: s.hex }}>
                  {formatCurrency(s.value)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.round((s.value / maxScenario) * 100)}%`,
                    backgroundColor: s.hex,
                    boxShadow: `0 0 8px ${s.hex}`,
                  }}
                />
              </div>
              <p className="mt-0.5 font-mono text-[9px] text-spectre-muted/60">{s.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pipeline by stage */}
      <div className="rounded-sm border border-spectre-cyan/15 bg-black/40 p-4">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-spectre-muted">
          Pipeline per stadio
        </p>
        <div className="flex flex-col gap-2">
          {byStage.map((st) => (
            <div key={st.status} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${LEAD_STATUS[st.status].dot}`} />
                <span className="font-mono text-xs text-spectre-text">
                  {LEAD_STATUS[st.status].label}
                </span>
                <span className="font-mono text-[10px] text-spectre-muted">· {st.count}</span>
              </span>
              <span className="font-mono text-xs text-spectre-muted">
                {formatCurrency(st.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
