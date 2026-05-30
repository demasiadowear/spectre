"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Check,
  Copy,
  Pause,
  Play,
  Power,
  Radio,
  RotateCcw,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import PulseRing from "@/components/ui/spectre/PulseRing";
import { MOCK_TRANSCRIPT } from "@/lib/mock-whisper";
import type {
  ApiResponse,
  ObjectionType,
  ResponseAngle,
  WhisperResponse,
} from "@/types";

// ============================================================
// SPECTRE WHISPER — real-time call objection assistant.
// Left deck (35%): Shadow Mode toggle + waveform + detected
// objection intel + 3 copy-on-click suggestion cards.
// Right panel (65%): live colour-coded transcript feed that
// streams a simulated discovery call. Every client turn asks
// /api/ai/whisper for the dominant objection + counters; every
// 5th line drops an inline AI insight.
// ============================================================

interface FeedLine {
  id: number;
  speaker: "cliente" | "tu" | "ai";
  text: string;
  time: string;
}

const OBJECTION_LABEL: Record<ObjectionType, string> = {
  prezzo: "Prezzo / Budget",
  tempistiche: "Tempistiche",
  concorrenza: "Concorrenza",
  autorita: "Autorità decisionale",
  bisogno: "Bisogno percepito",
  fiducia: "Fiducia / Garanzie",
};

const ANGLE_META: Record<
  ResponseAngle,
  { label: string; text: string; border: string; glow: "cyan" | "amber" | "green" }
> = {
  value: {
    label: "Valore",
    text: "text-spectre-cyan",
    border: "border-spectre-cyan/30",
    glow: "cyan",
  },
  urgency: {
    label: "Urgenza",
    text: "text-spectre-amber",
    border: "border-spectre-amber/30",
    glow: "amber",
  },
  social: {
    label: "Social proof",
    text: "text-spectre-green",
    border: "border-spectre-green/30",
    glow: "green",
  },
};

const STREAM_MS = 2200;

function Waveform({ active }: { active: boolean }) {
  const bars = useMemo(() => Array.from({ length: 32 }, (_, i) => i), []);
  return (
    <div className="flex h-12 items-center justify-center gap-[3px]">
      {bars.map((i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-spectre-magenta"
          animate={
            active
              ? { height: [5, 8 + ((i * 11) % 28), 5] }
              : { height: 4 }
          }
          transition={
            active
              ? {
                  duration: 0.6 + (i % 6) * 0.11,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
              : { duration: 0.3 }
          }
          style={{ opacity: active ? 0.85 : 0.2 }}
        />
      ))}
    </div>
  );
}

export default function WhisperConsole() {
  const [leadName, setLeadName] = useState("");
  const [company, setCompany] = useState("");
  const [shadowOn, setShadowOn] = useState(false);
  const [running, setRunning] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [whisper, setWhisper] = useState<WhisperResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const startRef = useRef(0);
  const reqIdRef = useRef(0);
  const whisperRef = useRef<WhisperResponse | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    whisperRef.current = whisper;
  }, [whisper]);

  const finished = shadowOn && !running && cursor >= MOCK_TRANSCRIPT.length;

  const stamp = useCallback((i: number) => {
    const d = new Date(startRef.current + i * 7000);
    return d.toTimeString().slice(0, 8);
  }, []);

  const insightText = useCallback(() => {
    const w = whisperRef.current;
    if (!w || !w.detected_objection) {
      return "Nessuna obiezione critica: mantieni il ritmo e guida verso il next step.";
    }
    const label = OBJECTION_LABEL[w.detected_objection];
    const angle = w.responses[0]?.type;
    const angleLabel = angle ? ANGLE_META[angle].label.toUpperCase() : "VALORE";
    return `Obiezione «${label}» dominante — rispondi con angolo ${angleLabel}.`;
  }, []);

  const analyze = useCallback(
    async (uptoIndex: number) => {
      const messages = MOCK_TRANSCRIPT.slice(0, uptoIndex + 1).map((l) => ({
        speaker: l.speaker,
        text: l.text,
      }));
      const myReq = ++reqIdRef.current;
      setAnalyzing(true);
      try {
        const res = await fetch("/api/ai/whisper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lead_name: leadName.trim() || undefined,
            company: company.trim() || undefined,
            messages,
          }),
        });
        const json: ApiResponse<WhisperResponse> = await res.json();
        if (myReq === reqIdRef.current && json.success && json.data) {
          setWhisper(json.data);
        }
      } catch {
        // Keep the previous suggestion on failure — never crash the call.
      } finally {
        if (myReq === reqIdRef.current) setAnalyzing(false);
      }
    },
    [leadName, company],
  );

  // Stable ref so the streaming effect doesn't restart when context inputs change.
  const analyzeRef = useRef(analyze);
  useEffect(() => {
    analyzeRef.current = analyze;
  }, [analyze]);

  // Streaming engine: append the next transcript line on a timer.
  useEffect(() => {
    if (!running) return;
    if (cursor >= MOCK_TRANSCRIPT.length) {
      setRunning(false);
      return;
    }
    const idx = cursor;
    const t = setTimeout(
      () => {
        const line = MOCK_TRANSCRIPT[idx];
        setFeed((prev) => [
          ...prev,
          { id: prev.length, speaker: line.speaker, text: line.text, time: stamp(idx) },
        ]);
        if (line.speaker === "cliente") void analyzeRef.current(idx);
        if ((idx + 1) % 5 === 0) {
          setFeed((prev) => [
            ...prev,
            { id: prev.length, speaker: "ai", text: insightText(), time: stamp(idx) },
          ]);
        }
        setCursor((c) => c + 1);
      },
      idx === 0 ? 500 : STREAM_MS,
    );
    return () => clearTimeout(t);
  }, [running, cursor, stamp, insightText]);

  // Auto-scroll the feed to the latest line.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const beginCall = useCallback(() => {
    startRef.current = Date.now();
    reqIdRef.current += 1;
    setFeed([]);
    setWhisper(null);
    setAnalyzing(false);
    setCursor(0);
    setShadowOn(true);
    setRunning(true);
  }, []);

  const toggleShadow = useCallback(() => {
    if (shadowOn) {
      setShadowOn(false);
      setRunning(false);
    } else {
      beginCall();
    }
  }, [shadowOn, beginCall]);

  const copy = useCallback(async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked — still flash so the action feels responsive.
    }
    setCopied(idx);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1200);
  }, []);

  const objection = whisper?.detected_objection ?? null;
  const confidencePct = whisper ? Math.round(whisper.confidence * 100) : 0;

  return (
    <div className="mt-4 grid min-h-0 gap-4 lg:grid-cols-[minmax(0,35fr)_minmax(0,65fr)]">
      {/* ---------- LEFT DECK ---------- */}
      <div className="flex flex-col gap-4">
        <GlassCard corners className="p-5" glow="magenta">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-spectre-magenta" />
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-muted">
                Shadow Mode
              </span>
            </div>
            <span
              className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] ${
                shadowOn ? "text-spectre-magenta" : "text-spectre-muted/60"
              }`}
            >
              {shadowOn && <PulseRing tone="magenta" size={6} />}
              {shadowOn ? "Ascolto attivo" : "Offline"}
            </span>
          </div>

          <Waveform active={shadowOn && running} />

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-muted">
                Contatto
              </label>
              <input
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                placeholder="Nome"
                className="w-full rounded-sm border border-spectre-magenta/20 bg-black/50 px-2.5 py-1.5 font-mono text-xs text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-magenta/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-muted">
                Azienda
              </label>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Azienda"
                className="w-full rounded-sm border border-spectre-magenta/20 bg-black/50 px-2.5 py-1.5 font-mono text-xs text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-magenta/50 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <NeonButton
              variant="magenta"
              filled={!shadowOn}
              size="sm"
              onClick={toggleShadow}
            >
              <Power className="h-3.5 w-3.5" />
              {shadowOn ? "Disattiva" : "Attiva shadow"}
            </NeonButton>
            {shadowOn && !finished && (
              <NeonButton
                variant="ghost"
                size="sm"
                onClick={() => setRunning((r) => !r)}
              >
                {running ? (
                  <>
                    <Pause className="h-3.5 w-3.5" /> Pausa
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" /> Riprendi
                  </>
                )}
              </NeonButton>
            )}
            {finished && (
              <NeonButton variant="ghost" size="sm" onClick={beginCall}>
                <RotateCcw className="h-3.5 w-3.5" /> Replay
              </NeonButton>
            )}
          </div>
        </GlassCard>

        {/* Detected objection intel */}
        <GlassCard className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-muted">
              Obiezione rilevata
            </span>
            {analyzing && (
              <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-cyan">
                <Activity className="h-3 w-3 animate-pulse" /> Analisi
              </span>
            )}
          </div>

          {objection ? (
            <>
              <p className="font-display text-xl font-bold text-spectre-magenta">
                {OBJECTION_LABEL[objection]}
              </p>
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-muted">
                  <span>Confidenza</span>
                  <span className="text-spectre-text">{confidencePct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                  <motion.div
                    className="h-full rounded-full bg-spectre-magenta"
                    initial={{ width: 0 }}
                    animate={{ width: `${confidencePct}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    style={{ boxShadow: "0 0 8px #ff006e" }}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="font-mono text-xs leading-relaxed text-spectre-muted">
              {shadowOn
                ? "In ascolto… nessuna obiezione critica al momento."
                : "Attiva lo Shadow Mode per avviare la call simulata."}
            </p>
          )}
        </GlassCard>

        {/* Suggestion cards */}
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-muted">
            Risposte suggerite
          </span>
          <AnimatePresence mode="popLayout">
            {whisper?.responses.length ? (
              whisper.responses.map((r, i) => {
                const meta = ANGLE_META[r.type];
                const isCopied = copied === i;
                return (
                  <motion.button
                    key={`${r.type}-${i}`}
                    type="button"
                    onClick={() => copy(i, r.text)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, delay: i * 0.06 }}
                    className={`group relative w-full rounded-md border ${meta.border} bg-black/40 p-3 text-left backdrop-blur-xl transition-all hover:bg-white/[0.03]`}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span
                        className={`font-mono text-[9px] uppercase tracking-[0.25em] ${meta.text}`}
                      >
                        {meta.label}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-muted opacity-0 transition-opacity group-hover:opacity-100">
                        {isCopied ? (
                          <>
                            <Check className="h-3 w-3 text-spectre-green" />
                            <span className="text-spectre-green">Copiato</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copia
                          </>
                        )}
                      </span>
                    </div>
                    <p className="text-sm leading-snug text-spectre-text">
                      {r.text}
                    </p>
                    <p className="mt-1.5 font-mono text-[10px] italic leading-snug text-spectre-muted">
                      {r.rationale}
                    </p>
                    <AnimatePresence>
                      {isCopied && (
                        <motion.span
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          className="pointer-events-none absolute right-2 top-2 rounded-sm border border-spectre-green/40 bg-spectre-green/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-green"
                        >
                          Copiato
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                );
              })
            ) : (
              <GlassCard className="p-4">
                <p className="font-mono text-xs text-spectre-muted">
                  Le risposte appaiono qui appena WHISPER rileva un&apos;obiezione.
                </p>
              </GlassCard>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ---------- RIGHT: TRANSCRIPT ---------- */}
      <GlassCard corners className="flex min-w-0 flex-col" glow="magenta">
        <div className="flex items-center justify-between border-b border-spectre-magenta/15 px-5 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-spectre-magenta" />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-muted">
              Transcript live
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted">
            {feed.length} righe
          </span>
        </div>

        <div
          ref={feedRef}
          className="flex h-[58vh] min-h-[440px] flex-col gap-3 overflow-y-auto px-5 py-4"
        >
          {feed.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Radio className="h-8 w-8 text-spectre-magenta/40" />
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-spectre-muted">
                Nessuna trasmissione
              </p>
              <p className="max-w-xs font-mono text-[11px] text-spectre-muted/70">
                Attiva lo Shadow Mode: WHISPER intercetta la conversazione e
                suggerisce le contro-risposte in tempo reale.
              </p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {feed.map((line) => (
              <motion.div
                key={line.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={
                  line.speaker === "ai"
                    ? "flex justify-center"
                    : line.speaker === "cliente"
                      ? "flex justify-start"
                      : "flex justify-end"
                }
              >
                {line.speaker === "ai" ? (
                  <p className="max-w-[88%] text-center font-mono text-[11px] italic leading-relaxed text-spectre-magenta">
                    <span className="opacity-60">[{line.time}]</span> 🤖{" "}
                    {line.text}
                  </p>
                ) : (
                  <div
                    className={`max-w-[78%] rounded-md border px-3 py-2 ${
                      line.speaker === "cliente"
                        ? "border-spectre-cyan/25 bg-spectre-cyan/[0.04]"
                        : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="mb-0.5 flex items-center gap-2">
                      <span
                        className={`font-mono text-[9px] uppercase tracking-[0.2em] ${
                          line.speaker === "cliente"
                            ? "text-spectre-cyan"
                            : "text-spectre-text/70"
                        }`}
                      >
                        {line.speaker === "cliente" ? "Cliente" : "Tu"}
                      </span>
                      <span className="font-mono text-[9px] text-spectre-muted/60">
                        [{line.time}]
                      </span>
                    </div>
                    <p
                      className={`text-sm leading-snug ${
                        line.speaker === "cliente"
                          ? "text-spectre-text"
                          : "text-spectre-text/85"
                      }`}
                    >
                      {line.text}
                    </p>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {running && (
            <div className="flex items-center gap-2 px-1 pt-1">
              <PulseRing tone="magenta" size={6} />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted">
                Trasmissione in corso…
              </span>
            </div>
          )}
          {finished && (
            <div className="flex items-center gap-2 px-1 pt-1">
              <Check className="h-3.5 w-3.5 text-spectre-green" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-green">
                Trasmissione terminata
              </span>
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
