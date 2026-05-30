"use client";

import { useTyping } from "@/hooks/useTyping";
import { cn } from "@/lib/utils";

interface TypingTextProps {
  text: string;
  speed?: number;
  startDelay?: number;
  className?: string;
  /** Show a blinking caret while typing. */
  caret?: boolean;
  enabled?: boolean;
  onDone?: () => void;
}

/** Animates text character-by-character (AI "thinking out loud" effect). */
export default function TypingText({
  text,
  speed = 30,
  startDelay = 0,
  className,
  caret = true,
  enabled = true,
  onDone,
}: TypingTextProps) {
  const { display, done } = useTyping(text, { speed, startDelay, enabled, onDone });

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {display}
      {caret && !done && (
        <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-blink bg-current align-middle" />
      )}
    </span>
  );
}
