import GlassCard from "@/components/ui/spectre/GlassCard";
import LoadingGrid from "@/components/ui/spectre/LoadingGrid";

interface ModuleStandbyProps {
  note: string;
}

/** Temporary panel shown for modules not yet wired (PHASE 3-5). */
export default function ModuleStandby({ note }: ModuleStandbyProps) {
  return (
    <GlassCard corners className="flex flex-col items-center gap-3 p-10">
      <LoadingGrid label="MODULO IN STANDBY" />
      <p className="max-w-md text-center font-mono text-xs leading-relaxed text-spectre-muted">
        {note}
      </p>
    </GlassCard>
  );
}
