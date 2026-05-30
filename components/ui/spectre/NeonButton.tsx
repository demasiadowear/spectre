"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Calm buttons: outline by default, solid accent when `filled`. No neon.
const neonButton = cva(
  "relative inline-flex items-center justify-center gap-2 rounded-sm border font-ui text-xs font-medium uppercase tracking-[0.12em] transition-colors duration-200 select-none disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-0",
  {
    variants: {
      variant: {
        cyan: "border-accent/50 text-accent hover:bg-accent/10 hover:border-accent focus-visible:ring-accent",
        magenta:
          "border-danger/50 text-danger hover:bg-danger/10 hover:border-danger focus-visible:ring-danger",
        amber:
          "border-ochre/50 text-ochre hover:bg-ochre/10 hover:border-ochre focus-visible:ring-ochre",
        green:
          "border-success/50 text-success hover:bg-success/10 hover:border-success focus-visible:ring-success",
        ghost:
          "border-transparent text-text2 hover:text-text hover:border-border",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-5",
        lg: "h-12 px-7 text-sm",
      },
      filled: { true: "", false: "" },
    },
    compoundVariants: [
      {
        filled: true,
        variant: "cyan",
        class: "bg-accent text-onaccent border-accent hover:bg-accent-hover hover:border-accent-hover",
      },
      {
        filled: true,
        variant: "magenta",
        class: "bg-danger text-onaccent border-danger hover:bg-danger",
      },
      {
        filled: true,
        variant: "green",
        class: "bg-success text-onaccent border-success hover:bg-success",
      },
      {
        filled: true,
        variant: "amber",
        class: "bg-ochre text-onaccent border-ochre hover:bg-ochre",
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
