"use client";

import GlassCard from "@/components/ui/spectre/GlassCard";
import { cn } from "@/lib/utils";
import type { AutopilotLead, AutopilotStage } from "@/types/autopilot";
import { AUTOPILOT_STAGES } from "@/lib/autopilot/constants";
import { STAGE_CHIP, STAGE_LABELS, TIER_BADGE, lastAction } from "./format";

interface Props {
  leads: AutopilotLead[];
  onOpen: (lead: AutopilotLead) => void;
}

// Vista alternativa a colonne (toggle dalla topbar). Le card
// restano minime: il dettaglio è sempre nel drawer.
export default function AutopilotKanban({ leads, onOpen }: Props) {
  const byStage = new Map<AutopilotStage, AutopilotLead[]>(
    AUTOPILOT_STAGES.map((s) => [s, []]),
  );
  for (const l of leads) byStage.get(l.stage)?.push(l);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {AUTOPILOT_STAGES.map((stage) => {
        const items = byStage.get(stage) ?? [];
        return (
          <GlassCard key={stage} className="flex flex-col p-3">
            <div className="mb-2 flex items-center justify-between border-b border-surface2 pb-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-ui text-[10px]",
                  STAGE_CHIP[stage],
                )}
              >
                {STAGE_LABELS[stage]}
              </span>
              <span className="font-display text-sm font-bold text-text">
                {items.length}
              </span>
            </div>
            <ul className="space-y-1.5">
              {items.slice(0, 10).map((l) => (
                <li key={l.lead_id}>
                  <button
                    type="button"
                    onClick={() => onOpen(l)}
                    className="w-full rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-surface2"
                  >
                    <span className="block truncate font-ui text-xs font-medium text-text">
                      {l.company}
                    </span>
                    <span className="block truncate font-ui text-[10px] text-text2">
                      <b className={cn("mr-1", TIER_BADGE[l.tier]?.split(" ")[1])}>
                        {l.tier}
                      </b>
                      {lastAction(l, null)}
                    </span>
                  </button>
                </li>
              ))}
              {items.length > 10 && (
                <li className="px-1 font-ui text-[10px] text-text2">
                  +{items.length - 10} altri
                </li>
              )}
              {items.length === 0 && (
                <li className="px-1 font-ui text-[10px] text-text2">—</li>
              )}
            </ul>
          </GlassCard>
        );
      })}
    </div>
  );
}
