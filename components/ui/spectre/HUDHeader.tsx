"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useHudStore } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";
import VoiceInterface from "@/components/voice/VoiceInterface";
import ThemeToggle from "@/components/layout/ThemeToggle";
import type { ApiResponse, Lead } from "@/types";

const MODULE_NAMES: Record<string, string> = {
  "/visor": "Pipeline",
  "/cockpit": "Cockpit",
  "/hunter": "Hunter",
  "/whisper": "Whisper",
  "/hand": "Hand",
  "/oracle": "Oracle",
  "/territorio": "Territorio",
  "/forecast": "Forecast",
};

/** D3 topbar: SPECTRE logo · modulo corrente · € in trattativa · toggle. */
export default function HUDHeader() {
  const negotiatingValue = useHudStore((s) => s.negotiatingValue);
  const setHudStats = useHudStore((s) => s.setHudStats);
  const pathname = usePathname();

  const moduleName =
    Object.entries(MODULE_NAMES).find(([href]) => pathname.startsWith(href))?.[1] ??
    "SPECTRE";

  // Seed counters on first paint if VISOR hasn't yet.
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
          negotiatingValue: json.data
            .filter((l) => l.status === "negotiating")
            .reduce((sum, l) => sum + l.value, 0),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setHudStats]);

  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-between gap-3 bg-header px-3 text-header-text sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="font-display text-sm font-bold uppercase tracking-[0.35em] text-header-text">
          SPECTRE
        </span>
        <span className="h-4 w-px bg-header-muted/40" />
        <span className="truncate text-[12px] uppercase tracking-[0.2em] text-header-muted">
          {moduleName}
        </span>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        {negotiatingValue > 0 && (
          <span className="flex items-baseline gap-1.5 text-[12px]">
            <span className="font-semibold tabular-nums text-header-accent">
              {formatCurrency(negotiatingValue)}
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.15em] text-header-muted sm:inline">
              in trattativa
            </span>
          </span>
        )}
        <VoiceInterface />
        <ThemeToggle />
      </div>
    </header>
  );
}
