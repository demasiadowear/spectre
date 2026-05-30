import { cn } from "@/lib/utils";

type Tone = "cyan" | "magenta" | "amber" | "green";

const TONE: Record<Tone, string> = {
  cyan: "bg-spectre-cyan",
  magenta: "bg-spectre-magenta",
  amber: "bg-spectre-amber",
  green: "bg-spectre-green",
};

interface PulseRingProps {
  tone?: Tone;
  className?: string;
  /** Diameter of the solid core dot in px. */
  size?: number;
}

/** A solid dot wrapped by an infinitely expanding ring — "needs attention". */
export default function PulseRing({
  tone = "magenta",
  className,
  size = 8,
}: PulseRingProps) {
  return (
    <span
      className={cn("relative inline-flex", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        className={cn(
          "absolute inset-0 rounded-full opacity-60 animate-pulse-ring",
          TONE[tone],
        )}
      />
      <span className={cn("relative inline-flex rounded-full", TONE[tone])}
        style={{ width: size, height: size }}
      />
    </span>
  );
}
