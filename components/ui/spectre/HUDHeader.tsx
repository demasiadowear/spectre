"use client";

import { useEffect, useState } from "react";
import { Activity, Radio, Wallet } from "lucide-react";
import { useHudStore } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";
import VoiceInterface from "@/components/voice/VoiceInterface";
import ThemeToggle from "@/components/layout/ThemeToggle";
import type { ApiResponse, Lead } from "@/types";

/** Top HUD bar: live clock, system status, active-lead + open-value counters. */
export default function HUDHeader() {
  const activeLeads = useHudStore((s) => s.activeLeads);
  const dealValueOpen = useHudStore((s) => s.dealValueOpen);
  const setHudStats = useHudStore((s) => s.setHudStats);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Seed counters from the API on first paint if VISOR hasn't yet.
  useEffect(() => {
    const state = useHudStore.getState();
    if (state.activeLeads !== 0 || state.dealValueOpen !== 0) return;
    let cancelled = false;
    fetch("/api/leads")
      .then((r) => r.json() as Promise<ApiResponse<Lead[]>>)
      .then((json) => {
        if (cancelled || !json.success || !json.data) return;
        const active = json.data.filter(
          (l) => l.status !== "closed" && l.status !== "lost",
        );
        setHudStats({
          activeLeads: active.length,
          dealValueOpen: active.reduce((sum, l) => sum + l.value, 0),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setHudStats]);

  const time = now
    ? now.toLocaleTimeString("it-IT", { hour12: false })
    : "--:--:--";
  const date = now
    ? now.toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-between gap-2 border-b border-border bg-surface px-3 backdrop-blur-xl sm:px-5">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.25em] text-spectre-green">
          <Radio className="h-3 w-3 animate-pulse" />
          <span className="hidden sm:inline">system online</span>
        </span>
        <span className="hidden h-3 w-px bg-spectre-cyan/20 sm:block" />
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-spectre-muted sm:block">
          {date}
        </span>
      </div>

      <div className="flex items-center gap-2.5 sm:gap-4">
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-spectre-amber">
          <Wallet className="h-3 w-3 shrink-0" />
          <span className="hidden sm:inline">{formatCurrency(dealValueOpen)} aperto</span>
          <span className="sm:hidden">{formatCurrency(dealValueOpen)}</span>
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-spectre-cyan">
          <Activity className="h-3 w-3 shrink-0" />
          {activeLeads}
          <span className="hidden sm:inline"> lead attivi</span>
        </span>

        <span className="hidden h-4 w-px bg-border sm:block" />
        <ThemeToggle />
        <VoiceInterface />

        <span className="hidden font-mono text-sm tabular-nums tracking-widest text-spectre-text text-glow-cyan sm:inline">
          {time}
        </span>
      </div>
    </header>
  );
}
