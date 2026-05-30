"use client";

import { motion } from "framer-motion";
import { Building2 } from "lucide-react";
import PulseRing from "@/components/ui/spectre/PulseRing";
import { probabilityHex, statusCardClass, statusIsFill } from "@/lib/constants";
import { cn, daysSince, formatCurrency } from "@/lib/utils";
import type { Lead } from "@/types";

interface LeadCardProps {
  lead: Lead;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onSelect: (id: string) => void;
}

/** A draggable pipeline card. Native HTML5 DnD on the inner div;
 *  Framer handles only enter/exit/layout on the wrapper. Click opens
 *  the action panel (drag and click don't conflict in the DnD spec). */
export default function LeadCard({
  lead,
  dragging,
  onDragStart,
  onDragEnd,
  onSelect,
}: LeadCardProps) {
  const stale = daysSince(lead.last_contact) > 7;
  const fill = statusIsFill(lead.status);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", lead.id);
    e.dataTransfer.effectAllowed = "move";
    onDragStart(lead.id);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        onClick={() => onSelect(lead.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(lead.id);
          }
        }}
        className={cn(
          "cursor-pointer rounded-sm p-2.5 transition-colors",
          statusCardClass(lead.status),
          !fill && "hover:border-accent/40",
          dragging && "opacity-40",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "flex min-w-0 items-center gap-1 text-[10px] uppercase tracking-wider",
              fill ? "text-white/75" : "text-spectre-muted",
            )}
          >
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.company}</span>
          </span>
          {stale && !fill && (
            <PulseRing tone="magenta" size={7} className="mt-0.5 shrink-0" />
          )}
        </div>

        <p
          className={cn(
            "mt-1 truncate font-display text-sm font-medium",
            fill ? "text-white" : "text-spectre-text",
          )}
        >
          {lead.name}
        </p>

        <div className="mt-2 flex items-center justify-between">
          <span className={cn("text-xs", fill ? "text-white" : "text-accent")}>
            {formatCurrency(lead.value)}
          </span>
          <span
            className="text-[10px] tabular-nums"
            style={{ color: fill ? "#fff" : probabilityHex(lead.probability) }}
          >
            {lead.probability}%
          </span>
        </div>

        {lead.next_action && (
          <p
            className={cn(
              "mt-1.5 truncate text-[10px]",
              fill ? "text-white/80" : "text-spectre-muted/70",
            )}
          >
            → {lead.next_action}
          </p>
        )}
      </div>
    </motion.div>
  );
}
