"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Mic, MicOff } from "lucide-react";
import { useVoice } from "@/hooks/useVoice";
import { useVoiceStore } from "@/lib/voice/store";
import VoiceCommandsModal from "./VoiceCommandsModal";
import type { VoiceStatus } from "@/types/voice";

const STATUS_META: Record<
  VoiceStatus,
  { label: string; color: string; ring: string }
> = {
  idle: { label: "VOCE", color: "#00f0ff", ring: "border-spectre-cyan/30" },
  listening: {
    label: "IN ASCOLTO",
    color: "#ff006e",
    ring: "border-spectre-magenta/70 shadow-neon-magenta",
  },
  processing: {
    label: "ANALISI",
    color: "#ffbe0b",
    ring: "border-spectre-amber/60 shadow-neon-amber",
  },
  speaking: {
    label: "SPECTRE",
    color: "#00f0ff",
    ring: "border-spectre-cyan/70 shadow-neon-cyan",
  },
  muted: { label: "MUTO", color: "#6b7280", ring: "border-white/15" },
};

function Waveform({ status }: { status: VoiceStatus }) {
  const active =
    status === "listening" || status === "speaking" || status === "processing";
  const color = status === "processing" ? "#ffbe0b" : "#00f0ff";
  const bars = [10, 18, 8, 22, 12, 16, 6];
  return (
    <div className="flex h-5 items-center gap-[2px]">
      {bars.map((peak, i) => (
        <motion.span
          key={i}
          className="w-[2px] rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
          animate={
            active
              ? { height: [3, peak, 6, peak - 4, 3] }
              : { height: 3, opacity: 0.4 }
          }
          transition={
            active
              ? {
                  duration: status === "processing" ? 0.6 : 0.9,
                  repeat: Infinity,
                  delay: i * 0.08,
                  ease: "easeInOut",
                }
              : { duration: 0.2 }
          }
        />
      ))}
    </div>
  );
}

export default function VoiceInterface() {
  const voice = useVoice();
  const [modalOpen, setModalOpen] = useState(false);
  const [fallbackText, setFallbackText] = useState("");
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  // Capability (Web Speech) is browser-only — defer capability-dependent
  // rendering to after mount so SSR and first client paint match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const blockedUrl = useVoiceStore((s) => s.blockedUrl);
  const setBlockedUrl = useVoiceStore((s) => s.setBlockedUrl);
  useEffect(() => {
    if (!blockedUrl) return;
    const t = setTimeout(() => setBlockedUrl(null), 8000);
    return () => clearTimeout(t);
  }, [blockedUrl, setBlockedUrl]);

  const meta = STATUS_META[voice.status];
  const active =
    voice.status === "listening" ||
    voice.status === "speaking" ||
    voice.status === "processing";

  const handleClick = () => {
    if (voice.status === "idle" || voice.status === "muted") voice.startListening();
    else voice.toggleMute();
  };

  const onPointerDown = () => {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setModalOpen(true);
    }, 1500);
  };
  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const onPointerUp = () => {
    const wasLong = longPressed.current;
    clearPress();
    if (!wasLong) handleClick();
  };

  const onFallbackKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const text = fallbackText.trim();
    if (!text) return;
    voice.submitText(text);
    setFallbackText("");
  };

  // Stable placeholder for SSR + first paint (avoids hydration mismatch).
  if (!mounted) {
    return (
      <div className="flex h-9 w-9 items-center justify-center" aria-hidden>
        <Mic className="h-[18px] w-[18px] text-spectre-cyan/40" strokeWidth={1.5} />
      </div>
    );
  }

  // Unsupported browser → text-command fallback (never crash).
  if (!voice.supported) {
    return (
      <div className="flex items-center gap-2">
        <input
          value={fallbackText}
          onChange={(e) => setFallbackText(e.target.value)}
          onKeyDown={onFallbackKey}
          placeholder="comando…"
          aria-label="Comando vocale testuale"
          className="h-7 w-28 rounded-sm border border-spectre-cyan/20 bg-black/40 px-2 font-mono text-[11px] text-spectre-text outline-none focus:border-spectre-cyan/50"
        />
        <MicOff className="h-4 w-4 text-spectre-muted" strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <>
      <div className="group relative flex items-center gap-2">
        {active && <Waveform status={voice.status} />}
        {voice.status !== "idle" && (
          <span
            className="hidden font-mono text-[10px] uppercase tracking-[0.2em] sm:inline"
            style={{ color: meta.color }}
          >
            {meta.label}
          </span>
        )}

        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={clearPress}
          aria-label="Comandi vocali"
          className={`flex h-9 w-9 items-center justify-center rounded-sm border bg-black/40 transition-all duration-200 ${meta.ring} ${
            voice.status === "listening" ? "animate-pulse" : ""
          }`}
        >
          {voice.status === "muted" ? (
            <MicOff className="h-[18px] w-[18px]" strokeWidth={1.5} style={{ color: meta.color }} />
          ) : (
            <Mic
              className="h-[18px] w-[18px]"
              strokeWidth={1.5}
              style={{ color: meta.color, opacity: voice.status === "idle" ? 0.7 : 1 }}
            />
          )}
        </button>

        {/* Hover tooltip */}
        <span className="pointer-events-none absolute right-0 top-11 z-50 whitespace-nowrap rounded-sm border border-spectre-cyan/20 bg-black/90 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-spectre-text opacity-0 backdrop-blur transition-opacity duration-150 group-hover:opacity-100">
          {voice.status === "idle"
            ? "Attiva voce · tieni premuto per i comandi"
            : "Click per silenziare"}
        </span>

        {/* Live interim transcript */}
        {voice.status === "listening" && voice.interimTranscript && (
          <span className="pointer-events-none absolute right-0 top-11 z-40 max-w-[200px] truncate rounded-sm border border-spectre-magenta/20 bg-black/90 px-2 py-1 font-mono text-[10px] text-spectre-magenta backdrop-blur">
            {voice.interimTranscript}
          </span>
        )}
      </div>

      <VoiceCommandsModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {/* Popup-blocked fallback — open via a real user gesture. */}
      <AnimatePresence>
        {blockedUrl && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 z-[80] -translate-x-1/2"
          >
            <a
              href={blockedUrl.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setBlockedUrl(null)}
              className="flex items-center gap-2 rounded-sm border border-spectre-amber/50 bg-spectre-panel/95 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.15em] text-spectre-amber shadow-neon-amber backdrop-blur-xl transition hover:bg-spectre-amber/10"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
              Popup bloccato — clicca per aprire {blockedUrl.label}
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
