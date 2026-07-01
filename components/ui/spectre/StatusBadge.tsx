import { statusMeta } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { LeadStatus } from "@/types";

interface StatusBadgeProps {
  status: LeadStatus;
  className?: string;
}

/** Pill badge with status-coloured dot + label. */
export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const meta = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
        meta.badge,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}
