import Link from "next/link";
import { Radio, Eye } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <GlassCard corners glow="cyan" className="w-full max-w-md p-10">
        <div className="flex flex-col items-center text-center">
          <Radio
            className="mb-5 h-10 w-10 text-spectre-cyan"
            strokeWidth={1.25}
          />
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-spectre-muted">
            Errore 404
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-[0.18em] text-spectre-cyan text-glow-cyan">
            SIGNAL LOST
          </h1>
          <p className="mt-4 max-w-xs font-mono text-xs leading-relaxed text-spectre-muted">
            Coordinate non mappate. La rotta richiesta non esiste in questo
            settore della rete SPECTRE.
          </p>

          <Link href="/pipeline" className="mt-8">
            <NeonButton variant="cyan" filled>
              <Eye className="h-4 w-4" strokeWidth={1.5} />
              Torna alla Pipeline
            </NeonButton>
          </Link>
        </div>
      </GlassCard>
    </div>
  );
}
