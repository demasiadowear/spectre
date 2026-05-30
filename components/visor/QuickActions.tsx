"use client";

import { useRouter } from "next/navigation";
import { AudioLines, Gauge, Hand, Network, Plus } from "lucide-react";
import NeonButton from "@/components/ui/spectre/NeonButton";

interface QuickActionsProps {
  onNewLead: () => void;
}

/** Row of 5 live actions — new lead + jump to each AI module. */
export default function QuickActions({ onNewLead }: QuickActionsProps) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NeonButton variant="cyan" filled size="sm" onClick={onNewLead}>
        <Plus className="h-3.5 w-3.5" />
        Nuovo lead
      </NeonButton>
      <NeonButton variant="magenta" size="sm" onClick={() => router.push("/whisper")}>
        <AudioLines className="h-3.5 w-3.5" />
        Whisper
      </NeonButton>
      <NeonButton variant="amber" size="sm" onClick={() => router.push("/hand")}>
        <Hand className="h-3.5 w-3.5" />
        Proposta
      </NeonButton>
      <NeonButton variant="green" size="sm" onClick={() => router.push("/oracle")}>
        <Gauge className="h-3.5 w-3.5" />
        Oracle
      </NeonButton>
      <NeonButton variant="cyan" size="sm" onClick={() => router.push("/mind")}>
        <Network className="h-3.5 w-3.5" />
        Mind
      </NeonButton>
    </div>
  );
}
