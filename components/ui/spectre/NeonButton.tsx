"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const neonButton = cva(
  "relative inline-flex items-center justify-center gap-2 rounded-sm border font-mono text-xs uppercase tracking-[0.2em] transition-all duration-200 select-none disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1",
  {
    variants: {
      variant: {
        cyan: "border-spectre-cyan/40 text-spectre-cyan hover:bg-spectre-cyan/10 hover:shadow-neon-cyan hover:border-spectre-cyan focus-visible:ring-spectre-cyan",
        magenta:
          "border-spectre-magenta/40 text-spectre-magenta hover:bg-spectre-magenta/10 hover:shadow-neon-magenta hover:border-spectre-magenta focus-visible:ring-spectre-magenta",
        amber:
          "border-spectre-amber/40 text-spectre-amber hover:bg-spectre-amber/10 hover:shadow-neon-amber hover:border-spectre-amber focus-visible:ring-spectre-amber",
        green:
          "border-spectre-green/40 text-spectre-green hover:bg-spectre-green/10 hover:shadow-neon-green hover:border-spectre-green focus-visible:ring-spectre-green",
        ghost:
          "border-transparent text-spectre-muted hover:text-spectre-text hover:border-spectre-cyan/20",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-5",
        lg: "h-12 px-7 text-sm",
      },
      filled: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      {
        filled: true,
        variant: "cyan",
        class: "bg-spectre-cyan/15 shadow-neon-cyan",
      },
      {
        filled: true,
        variant: "magenta",
        class: "bg-spectre-magenta/15 shadow-neon-magenta",
      },
    ],
    defaultVariants: { variant: "cyan", size: "md", filled: false },
  },
);

export interface NeonButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof neonButton> {}

const NeonButton = forwardRef<HTMLButtonElement, NeonButtonProps>(
  ({ className, variant, size, filled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(neonButton({ variant, size, filled }), className)}
      {...props}
    />
  ),
);
NeonButton.displayName = "NeonButton";

export default NeonButton;
