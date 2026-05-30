"use client";

import { Bot } from "lucide-react";
import { motion } from "framer-motion";
import TypingText from "./TypingText";
import { cn } from "@/lib/utils";

interface AIMessageProps {
  text: string;
  /** Disable the typing animation (e.g. for historical messages). */
  instant?: boolean;
  speed?: number;
  className?: string;
}

/** A SPECTRE AI utterance — magenta accent, robot glyph, typing reveal. */
export default function AIMessage({
  text,
  instant = false,
  speed = 22,
  className,
}: AIMessageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "flex items-start gap-2 rounded-sm border border-spectre-magenta/25 bg-spectre-magenta/5 px-3 py-2",
        className,
      )}
    >
      <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-spectre-magenta" />
      <div className="font-mono text-xs italic leading-relaxed text-spectre-magenta/90">
        <TypingText text={text} enabled={!instant} speed={speed} caret={!instant} />
      </div>
    </motion.div>
  );
}
