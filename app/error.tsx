"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Eye } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the failure for diagnostics; never swallow it silently.
    console.error("[SPECTRE] runtime failure:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <GlassCard corners glow="magenta" className="w-full max-w-md p-10">
        <div className="flex flex-col items-center text-center">
          <AlertTriangle
            className="mb-5 h-10 w-10 text-spectre-magenta"
            strokeWidth={1.25}
          />
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-spectre-muted">
            Errore 500
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-[0.18em] text-spectre-magenta text-glow-magenta">
            SYSTEM FAILURE
          </h1>
          <p className="mt-4 max-w-xs font-mono text-xs leading-relaxed text-spectre-muted">
            Un modulo neurale ha smesso di rispondere. Il segnale è stato
            isolato — puoi tentare un riavvio a caldo.
          </p>

          {error.digest && (
            <code className="mt-4 rounded-sm border border-spectre-magenta/20 bg-black/50 px-2 py-1 font-mono text-[10px] text-spectre-muted">
              trace: {error.digest}
            </code>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <NeonButton variant="magenta" filled onClick={reset}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
              Riavvia modulo
            </NeonButton>
            <Link href="/visor">
              <NeonButton variant="ghost">
                <Eye className="h-4 w-4" strokeWidth={1.5} />
                Torna al Visor
              </NeonButton>
            </Link>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
