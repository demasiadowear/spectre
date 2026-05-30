import { cn } from "@/lib/utils";

interface ModuleHeaderProps {
  index: string;
  label: string;
  title: string;
  subtitle?: string;
  accent?: "cyan" | "magenta" | "amber" | "green";
}

const ACCENT: Record<NonNullable<ModuleHeaderProps["accent"]>, string> = {
  cyan: "text-spectre-cyan",
  magenta: "text-spectre-magenta",
  amber: "text-spectre-amber",
  green: "text-spectre-green",
};

/** Reusable module header with a giant watermark index, à la AYROMEX sections. */
export default function ModuleHeader({
  index,
  label,
  title,
  subtitle,
  accent = "cyan",
}: ModuleHeaderProps) {
  return (
    <div className="relative mb-6">
      <span className="pointer-events-none absolute -top-6 right-0 select-none font-display text-[7rem] font-bold leading-none text-text opacity-[0.03]">
        {index}
      </span>
      <span
        className={cn(
          "font-mono text-[11px] uppercase tracking-[0.4em]",
          ACCENT[accent],
        )}
      >
        / {label}
      </span>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-spectre-text">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 max-w-xl font-ui text-sm text-spectre-muted">
          {subtitle}
        </p>
      )}
    </div>
  );
}
