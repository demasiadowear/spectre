"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import LeadCard from "./LeadCard";
import { LEAD_STATUS } from "@/lib/constants";
import { cn, formatCurrency } from "@/lib/utils";
import type { Lead, LeadStatus } from "@/types";

interface PipelineColumnProps {
  status: LeadStatus;
  leads: Lead[];
  draggingId: string | null;
  onDragStartCard: (id: string) => void;
  onDragEndCard: () => void;
  onDropLead: (id: string, status: LeadStatus) => void;
  onSelectCard: (id: string) => void;
}

/** One kanban column. Accepts dropped cards and re-assigns their status. */
export default function PipelineColumn({
  status,
  leads,
  draggingId,
  onDragStartCard,
  onDragEndCard,
  onDropLead,
  onSelectCard,
}: PipelineColumnProps) {
  const [over, setOver] = useState(false);
  const meta = LEAD_STATUS[status];
  const total = leads.reduce((sum, l) => sum + l.value, 0);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData("text/plain");
    if (id) onDropLead(id, status);
  };

  return (
    <div className="flex w-[210px] shrink-0 flex-col">
      <div
        className={cn(
          "mb-2 flex items-center justify-between border-b-2 px-1 pb-1.5",
          meta.headerAccent,
        )}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-spectre-text">
          <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
          {meta.label}
          <span className="text-spectre-muted">· {leads.length}</span>
        </span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!over) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex min-h-[140px] flex-1 flex-col gap-2 rounded-sm border border-dashed border-transparent p-1.5 transition-colors",
          over && "border-spectre-cyan/50 bg-spectre-cyan/5",
        )}
      >
        <AnimatePresence initial={false}>
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              dragging={lead.id === draggingId}
              onDragStart={onDragStartCard}
              onDragEnd={onDragEndCard}
              onSelect={onSelectCard}
            />
          ))}
        </AnimatePresence>

        {leads.length === 0 && (
          <span className="m-auto font-mono text-[10px] uppercase tracking-widest text-spectre-muted/40">
            vuoto
          </span>
        )}
      </div>

      {total > 0 && (
        <span className="mt-1.5 px-1 font-mono text-[10px] tabular-nums text-spectre-muted">
          {formatCurrency(total)}
        </span>
      )}
    </div>
  );
}
