import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Glow = "cyan" | "magenta" | "amber" | "green" | "none";

const GLOW: Record<Glow, string> = {
  cyan: "hover:shadow-neon-cyan hover:border-spectre-cyan/40",
  magenta: "hover:shadow-neon-magenta hover:border-spectre-magenta/40",
  amber: "hover:shadow-neon-amber hover:border-spectre-amber/40",
  green: "hover:shadow-neon-green hover:border-spectre-green/40",
  none: "",
};

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: Glow;
  /** Render decorative corner brackets. */
  corners?: boolean;
}

/** Frosted glass surface — the base panel for the whole HUD. */
const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, glow = "none", corners = false, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative rounded-sm border border-spectre-cyan/15 bg-black/40 backdrop-blur-2xl",
        "shadow-glass transition-all duration-300",
        GLOW[glow],
        className,
      )}
      {...props}
    >
      {corners && (
        <>
          <span className="pointer-events-none absolute left-0 top-0 h-3 w-3 border-l border-t border-spectre-cyan/50" />
          <span className="pointer-events-none absolute right-0 top-0 h-3 w-3 border-r border-t border-spectre-cyan/50" />
          <span className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 border-b border-l border-spectre-cyan/50" />
          <span className="pointer-events-none absolute bottom-0 right-0 h-3 w-3 border-b border-r border-spectre-cyan/50" />
        </>
      )}
      {children}
    </div>
  ),
);
GlassCard.displayName = "GlassCard";

export default GlassCard;
