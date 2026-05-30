"use client";

import { useEffect, useRef, useState } from "react";

interface UseTypingOptions {
  /** ms per character. */
  speed?: number;
  /** delay before typing starts (ms). */
  startDelay?: number;
  enabled?: boolean;
  onDone?: () => void;
}

/**
 * Reveals `text` character by character. Respects prefers-reduced-motion
 * (shows the full string immediately when motion is reduced).
 */
export function useTyping(
  text: string,
  { speed = 30, startDelay = 0, enabled = true, onDone }: UseTypingOptions = {},
): { display: string; done: boolean } {
  const [display, setDisplay] = useState("");
  const [done, setDone] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!enabled) {
      setDisplay(text);
      setDone(true);
      return;
    }

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      setDisplay(text);
      setDone(true);
      doneRef.current?.();
      return;
    }

    setDisplay("");
    setDone(false);
    let i = 0;
    let interval: ReturnType<typeof setInterval>;

    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setDisplay(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(interval);
          setDone(true);
          doneRef.current?.();
        }
      }, speed);
    }, startDelay);

    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [text, speed, startDelay, enabled]);

  return { display, done };
}
