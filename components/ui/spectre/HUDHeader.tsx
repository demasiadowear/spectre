"use client";

import { usePathname } from "next/navigation";
import VoiceInterface from "@/components/voice/VoiceInterface";
import ThemeToggle from "@/components/layout/ThemeToggle";

const MODULE_NAMES: Record<string, string> = {
  "/pipeline": "Pipeline",
  "/hunter": "Hunter",
  "/hand": "Hand",
  "/detective": "Detective",
  "/templates": "Templates",
};

/** Topbar: SPECTRE logo · modulo corrente · voce · toggle tema. */
export default function HUDHeader() {
  const pathname = usePathname();

  const moduleName =
    Object.entries(MODULE_NAMES).find(([href]) => pathname.startsWith(href))?.[1] ??
    "SPECTRE";

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
        <VoiceInterface />
        <ThemeToggle />
      </div>
    </header>
  );
}
