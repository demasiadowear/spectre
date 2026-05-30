import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Glow = "cyan" | "magenta" | "amber" | "green" | "none";

// "glow" now just tints the hover border (no neon). Kept for API compat.
const GLOW: Record<Glow, string> = {
  cyan: "hover:border-accent/40",
  magenta: "hover:border-danger/40",
  amber: "hover:border-ochre/40",
  green: "hover:border-success/40",
  none: "",
};

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: Glow;
  /** Deprecated cyberpunk corner brackets — ignored in the paper theme. */
  corners?: boolean;
}

/** Calm paper surface — flat card, 1px border, soft shadow. */
const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, glow = "none", corners: _corners, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative rounded-sm border border-border bg-surface shadow-card transition-colors duration-200",
        GLOW[glow],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
GlassCard.displayName = "GlassCard";

export default GlassCard;
