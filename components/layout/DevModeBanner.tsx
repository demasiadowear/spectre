import { AUTH_DISABLED } from "@/lib/auth";

/**
 * Fixed warning shown only when SPECTRE_PASSWORD is unset, i.e. the app is
 * running open with no authentication. Server component — reads env directly.
 * pointer-events-none so it never intercepts clicks.
 */
export default function DevModeBanner() {
  if (!AUTH_DISABLED) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-sm border border-spectre-amber/50 bg-black/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-amber shadow-neon-amber backdrop-blur">
        <span className="inline-block h-1.5 w-1.5 animate-blink rounded-full bg-spectre-amber" />
        DEV MODE — NO AUTH
      </div>
    </div>
  );
}
