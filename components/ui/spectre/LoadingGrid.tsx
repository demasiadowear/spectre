"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface LoadingGridProps {
  label?: string;
  className?: string;
}

/** Cyberpunk loader — a 3×3 grid of cells that flicker in sequence. */
export default function LoadingGrid({
  label = "ELABORAZIONE",
  className,
}: LoadingGridProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-10",
        className,
      )}
    >
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 9 }).map((_, i) => (
          <motion.span
            key={i}
            className="h-3 w-3 rounded-[1px] bg-spectre-cyan"
            initial={{ opacity: 0.12 }}
            animate={{ opacity: [0.12, 1, 0.12] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: (i % 3) * 0.15 + Math.floor(i / 3) * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      {label && (
        <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-spectre-cyan/70">
          {label}
        </span>
      )}
    </div>
  );
}
