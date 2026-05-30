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
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  RotateCcw,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import PulseRing from "@/components/ui/spectre/PulseRing";
import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  type SRInstance,
} from "@/lib/voice/speech-recognition";
import { MOCK_TRANSCRIPT } from "@/lib/mock-whisper";
import type {
  ApiResponse,
  Lead,
  ObjectionType,
  ResponseAngle,
  WhisperResponse,
} from "@/types";

// ============================================================
// SPECTRE WHISPER — real-time call objection assistant.
// LIVE mode: the browser mic (Web Speech API, it-IT) transcribes the
// call; every "cliente" utterance is sent to /api/ai/whisper for the
// dominant objection + 3 counters. DEMO mode replays a scripted call
// when no mic is available. Left deck = intel + copy-on-tap responses,
// right panel = colour-coded live transcript.
// ============================================================

type Speaker = "cliente" | "tu" | "ai";

interface FeedLine {
  id: number;
  speaker: Speaker;
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
  { label: string; text: string; border: string }
> = {
  value: { label: "Valore", text: "text-spectre-cyan", border: "border-spectre-cyan/30" },
  urgency: { label: "Urgenza", text: "text-spectre-amber", border: "border-spectre-amber/30" },
  social: { label: "Social proof", text: "text-spectre-green", border: "border-spectre-green/30" },
};

const STREAM_MS = 2200;

function Waveform({ active, level }: { active: boolean; level?: number }) {
  const bars = useMemo(() => Array.from({ length: 28 }, (_, i) => i), []);
  const live = typeof level === "number";
  return (
    <div className="flex h-12 items-center justify-center gap-[3px]">
      {bars.map((i) => {
        if (live) {
          // Real mic energy: centre bars taller, height scaled by input level.
          const centre = 1 - Math.abs(i - 13.5) / 13.5;
          const h = active ? 4 + (level as number) * 40 * (0.45 + 0.55 * centre) : 4;
          return (
            <span
              key={i}
              className="w-[3px] rounded-full bg-spectre-magenta transition-[height] duration-75"
              style={{ height: h, opacity: active ? 0.9 : 0.25 }}
            />
          );
        }
        return (
          <motion.span
            key={i}
            className="w-[3px] rounded-full bg-spectre-magenta"
            animate={active ? { height: [5, 8 + ((i * 11) % 28), 5] } : { height: 4 }}
            transition={
              active
                ? { duration: 0.6 + (i % 6) * 0.11, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0.3 }
            }
            style={{ opacity: active ? 0.85 : 0.2 }}
          />
        );
      })}
    </div>
  );
}

const TONE_META: Record<
  NonNullable<WhisperResponse["client_tone"]>,
  { label: string; cls: string }
> = {
  freddo: { label: "❄️ Freddo", cls: "border-spectre-cyan/40 text-spectre-cyan bg-spectre-cyan/10" },
  scettico: { label: "🤨 Scettico", cls: "border-spectre-amber/40 text-spectre-amber bg-spectre-amber/10" },
  interessato: { label: "👀 Interessato", cls: "border-spectre-green/40 text-spectre-green bg-spectre-green/10" },
  irritato: { label: "🔥 Irritato", cls: "border-spectre-magenta/40 text-spectre-magenta bg-spectre-magenta/10" },
  esitante: { label: "😐 Esitante", cls: "border-spectre-amber/40 text-spectre-amber bg-spectre-amber/10" },
  entusiasta: { label: "🚀 Entusiasta", cls: "border-spectre-green/40 text-spectre-green bg-spectre-green/10" },
  neutro: { label: "• Neutro", cls: "border-white/20 text-spectre-muted bg-white/5" },
};

function nowStamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export default function WhisperConsole() {
  const [mode, setMode] = useState<"live" | "demo">("demo");
  const [supported, setSupported] = useState(false);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadName, setLeadName] = useState("");
  const [company, setCompany] = useState("");

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [activeSpeaker, setActiveSpeaker] = useState<"cliente" | "tu">("cliente");
  const [micError, setMicError] = useState<string | null>(null);

  // Demo replay state.
  const [running, setRunning] = useState(false);
  const [cursor, setCursor] = useState(0);

  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [whisper, setWhisper] = useState<WhisperResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const reqIdRef = useRef(0);
  const whisperRef = useRef<WhisperResponse | null>(null);
  const messagesRef = useRef<{ speaker: "cliente" | "tu"; text: string }[]>([]);
  const lineCountRef = useRef(0);
  const recRef = useRef<SRInstance | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<{
    ctx: AudioContext;
    stream: MediaStream;
    raf: number;
  } | null>(null);

  // Real mic-energy meter (Web Audio) → drives the live waveform "tono voce".
  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const entry = { ctx, stream, raf: 0 };
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let k = 0; k < data.length; k++) {
          const x = (data[k] - 128) / 128;
          sum += x * x;
        }
        setMicLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
        if (audioRef.current === entry) entry.raf = requestAnimationFrame(loop);
      };
      audioRef.current = entry;
      entry.raf = requestAnimationFrame(loop);
    } catch {
      /* meter is optional — speech recognition still works without it */
    }
  }, []);

  const stopMeter = useCallback(() => {
    const a = audioRef.current;
    audioRef.current = null;
    setMicLevel(0);
    if (a) {
      cancelAnimationFrame(a.raf);
      a.stream.getTracks().forEach((t) => t.stop());
      void a.ctx.close().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    whisperRef.current = whisper;
  }, [whisper]);

  // Detect mic support + default to LIVE when available. Load leads.
  useEffect(() => {
    const ok = isSpeechRecognitionSupported();
    setSupported(ok);
    setMode(ok ? "live" : "demo");
    fetch("/api/leads")
      .then((r) => r.json() as Promise<ApiResponse<Lead[]>>)
      .then((j) => {
        if (j.success && j.data) setLeads(j.data);
      })
      .catch(() => undefined);
  }, []);

  const insightText = useCallback(() => {
    const w = whisperRef.current;
    if (!w || !w.detected_objection) {
      return "Nessuna obiezione critica: mantieni il ritmo e guida verso il next step.";
    }
    const angle = w.responses[0]?.type;
    const angleLabel = angle ? ANGLE_META[angle].label.toUpperCase() : "VALORE";
    return `Obiezione «${OBJECTION_LABEL[w.detected_objection]}» dominante — rispondi con angolo ${angleLabel}.`;
  }, []);

  const analyze = useCallback(async () => {
    const messages = messagesRef.current.slice(-12);
    if (messages.length === 0) return;
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
      /* keep previous suggestion on failure */
    } finally {
      if (myReq === reqIdRef.current) setAnalyzing(false);
    }
  }, [leadName, company]);

  const analyzeRef = useRef(analyze);
  useEffect(() => {
    analyzeRef.current = analyze;
  }, [analyze]);

  // Append a line to the feed, the analysis buffer, and (every 5th turn)
  // an inline AI insight. Used by both LIVE and DEMO engines.
  const pushLine = useCallback(
    (speaker: "cliente" | "tu", text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setFeed((prev) => [
        ...prev,
        { id: prev.length, speaker, text: clean, time: nowStamp() },
      ]);
      messagesRef.current.push({ speaker, text: clean });
      lineCountRef.current += 1;
      if (speaker === "cliente") void analyzeRef.current();
      if (lineCountRef.current % 5 === 0) {
        setFeed((prev) => [
          ...prev,
          { id: prev.length, speaker: "ai", text: insightText(), time: nowStamp() },
        ]);
      }
    },
    [insightText],
  );

  const resetCall = useCallback(() => {
    reqIdRef.current += 1;
    messagesRef.current = [];
    lineCountRef.current = 0;
    setFeed([]);
    setWhisper(null);
    setAnalyzing(false);
    setInterim("");
    setCursor(0);
  }, []);

  // ----- LIVE engine: Web Speech API -----
  const startListening = useCallback(() => {
    setMicError(null);
    const rec = createSpeechRecognition();
    if (!rec) {
      setMicError("Riconoscimento vocale non supportato su questo browser.");
      return;
    }
    rec.onresult = (e) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interimChunk += r[0].transcript;
      }
      if (interimChunk) setInterim(interimChunk);
      if (finalChunk) {
        setInterim("");
        pushLine(activeSpeaker, finalChunk);
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setMicError("Permesso microfono negato. Abilitalo nel browser.");
        setListening(false);
      } else if (ev.error === "no-speech") {
        /* ignore — keep listening */
      } else {
        setMicError(`Errore microfono: ${ev.error}`);
      }
    };
    rec.onend = () => {
      // Auto-restart while the user still wants to listen (continuous drops).
      if (recRef.current === rec && listeningRef.current) {
        try {
          rec.start();
        } catch {
          setListening(false);
        }
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setMicError("Impossibile avviare il microfono.");
    }
  }, [activeSpeaker]);

  const listeningRef = useRef(false);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  const stopListening = useCallback(() => {
    setListening(false);
    setInterim("");
    stopMeter();
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
  }, [stopMeter]);

  const toggleLive = useCallback(() => {
    if (listening) {
      stopListening();
    } else {
      resetCall();
      startListening();
      void startMeter();
    }
  }, [listening, stopListening, resetCall, startListening, startMeter]);

  // ----- DEMO engine: scripted replay -----
  const beginDemo = useCallback(() => {
    resetCall();
    setRunning(true);
  }, [resetCall]);

  useEffect(() => {
    if (mode !== "demo" || !running) return;
    if (cursor >= MOCK_TRANSCRIPT.length) {
      setRunning(false);
      return;
    }
    const idx = cursor;
    const t = setTimeout(
      () => {
        const line = MOCK_TRANSCRIPT[idx];
        pushLine(line.speaker, line.text);
        setCursor((c) => c + 1);
      },
      idx === 0 ? 400 : STREAM_MS,
    );
    return () => clearTimeout(t);
  }, [mode, running, cursor, pushLine]);

  // Auto-scroll feed.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed, interim]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.onend = null;
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
      const a = audioRef.current;
      audioRef.current = null;
      if (a) {
        cancelAnimationFrame(a.raf);
        a.stream.getTracks().forEach((t) => t.stop());
        void a.ctx.close().catch(() => undefined);
      }
    };
  }, []);

  const copy = useCallback(async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked */
    }
    setCopied(idx);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1200);
  }, []);

  const pickLead = (id: string) => {
    const l = leads.find((x) => x.id === id);
    if (l) {
      setLeadName(l.name);
      setCompany(l.company);
    }
  };

  const objection = whisper?.detected_objection ?? null;
  const confidencePct = whisper ? Math.round(whisper.confidence * 100) : 0;
  const demoFinished = mode === "demo" && !running && cursor >= MOCK_TRANSCRIPT.length;
  const active = mode === "live" ? listening : running;

  return (
    <div className="mt-4 grid min-h-0 gap-4 lg:grid-cols-[minmax(0,62fr)_minmax(0,38fr)]">
      {/* ---------- LEFT DECK (PRIMARY: cosa rispondere) ---------- */}
      <div className="flex flex-col gap-4">
        <GlassCard corners className="p-4 sm:p-5" glow="magenta">
          {/* Mode toggle */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-spectre-magenta" />
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-spectre-muted">
                Whisper
              </span>
            </div>
            <div className="flex overflow-hidden rounded-sm border border-spectre-magenta/25">
              <button
                type="button"
                onClick={() => {
                  if (listening) stopListening();
                  setMode("live");
                }}
                disabled={!supported}
                className={`px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] disabled:opacity-40 ${
                  mode === "live" ? "bg-spectre-magenta/20 text-spectre-magenta" : "text-spectre-muted"
                }`}
              >
                🎤 Live
              </button>
              <button
                type="button"
                onClick={() => {
                  if (listening) stopListening();
                  setMode("demo");
                }}
                className={`px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] ${
                  mode === "demo" ? "bg-spectre-magenta/20 text-spectre-magenta" : "text-spectre-muted"
                }`}
              >
                Demo
              </button>
            </div>
          </div>

          <Waveform active={active} level={mode === "live" ? micLevel : undefined} />

          {/* Lead picker */}
          {leads.length > 0 && (
            <div className="mt-4">
              <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-muted">
                Lead (dal CRM)
              </label>
              <select
                onChange={(e) => pickLead(e.target.value)}
                defaultValue=""
                className="w-full rounded-sm border border-spectre-magenta/20 bg-black/50 px-2.5 py-2 font-mono text-xs text-spectre-text focus:border-spectre-magenta/50 focus:outline-none"
              >
                <option value="" className="bg-spectre-panel">
                  — scegli un lead —
                </option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id} className="bg-spectre-panel">
                    {l.company} — {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              value={leadName}
              onChange={(e) => setLeadName(e.target.value)}
              placeholder="Contatto"
              className="w-full rounded-sm border border-spectre-magenta/20 bg-black/50 px-2.5 py-2 font-mono text-xs text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-magenta/50 focus:outline-none"
            />
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Azienda"
              className="w-full rounded-sm border border-spectre-magenta/20 bg-black/50 px-2.5 py-2 font-mono text-xs text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-magenta/50 focus:outline-none"
            />
          </div>

          {/* Controls */}
          {mode === "live" ? (
            <>
              {/* Speaker toggle */}
              <div className="mt-3 flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-muted">
                  Sto sentendo:
                </span>
                <div className="flex overflow-hidden rounded-sm border border-white/15">
                  {(["cliente", "tu"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setActiveSpeaker(s)}
                      className={`px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] ${
                        activeSpeaker === s
                          ? "bg-spectre-cyan/15 text-spectre-cyan"
                          : "text-spectre-muted"
                      }`}
                    >
                      {s === "cliente" ? "Cliente" : "Io"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <NeonButton
                  variant="magenta"
                  filled={!listening}
                  size="sm"
                  onClick={toggleLive}
                >
                  {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  {listening ? "Stop ascolto" : "Avvia ascolto"}
                </NeonButton>
                {feed.length > 0 && !listening && (
                  <NeonButton variant="ghost" size="sm" onClick={resetCall}>
                    <RotateCcw className="h-3.5 w-3.5" /> Pulisci
                  </NeonButton>
                )}
              </div>
              {micError && (
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-spectre-magenta">
                  {micError}
                </p>
              )}
            </>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <NeonButton
                variant="magenta"
                filled={!running}
                size="sm"
                onClick={running ? () => setRunning(false) : beginDemo}
              >
                {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {running ? "Pausa" : demoFinished ? "Replay" : "Avvia demo"}
              </NeonButton>
            </div>
          )}
        </GlassCard>

        {/* Detected objection intel */}
        <GlassCard className="p-4 sm:p-5">
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

          {whisper?.client_tone && (
            <div className="mb-3 flex flex-col gap-1.5 rounded-sm border border-white/10 bg-black/30 p-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-muted">
                  Tono cliente
                </span>
                <span
                  className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${TONE_META[whisper.client_tone].cls}`}
                >
                  {TONE_META[whisper.client_tone].label}
                </span>
              </div>
              {whisper.tone_note && (
                <p className="font-mono text-[11px] leading-snug text-spectre-text/80">
                  {whisper.tone_note}
                </p>
              )}
            </div>
          )}

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
              {active
                ? "In ascolto… nessuna obiezione critica al momento."
                : mode === "live"
                  ? "Avvia l'ascolto: WHISPER trascrive la call e rileva le obiezioni in tempo reale."
                  : "Avvia la demo per vedere WHISPER in azione."}
            </p>
          )}
        </GlassCard>

        {/* Suggestion cards — PRIMARY focus: what to say now */}
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-spectre-magenta">
            ▸ Cosa rispondere
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
                    className={`group relative w-full rounded-md border ${meta.border} bg-black/40 p-3.5 text-left backdrop-blur-xl transition-all hover:bg-white/[0.04]`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`font-mono text-[10px] uppercase tracking-[0.25em] ${meta.text}`}>
                        {meta.label}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted">
                        {isCopied ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-spectre-green" />
                            <span className="text-spectre-green">Copiato</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" /> Copia
                          </>
                        )}
                      </span>
                    </div>
                    <p className="text-[15px] font-medium leading-snug text-spectre-text">
                      {r.text}
                    </p>
                    <p className="mt-2 font-mono text-[10px] italic leading-snug text-spectre-muted">
                      {r.rationale}
                    </p>
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
        <div className="flex items-center justify-between border-b border-spectre-magenta/15 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-spectre-magenta" />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-muted">
              Transcript {mode === "live" ? "live" : "demo"}
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted">
            {feed.filter((f) => f.speaker !== "ai").length} righe
          </span>
        </div>

        <div
          ref={feedRef}
          className="flex h-[30vh] min-h-[180px] flex-col gap-3 overflow-y-auto px-4 py-4 sm:h-[62vh] sm:px-5"
        >
          {feed.length === 0 && !interim && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Radio className="h-8 w-8 text-spectre-magenta/40" />
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-spectre-muted">
                Nessuna trasmissione
              </p>
              <p className="max-w-xs font-mono text-[11px] text-spectre-muted/70">
                {mode === "live"
                  ? "Metti la chiamata in vivavoce e avvia l'ascolto: WHISPER trascrive e suggerisce le contro-risposte."
                  : "Avvia la demo: WHISPER intercetta una call simulata e suggerisce le risposte."}
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
                  <p className="max-w-[90%] text-center font-mono text-[11px] italic leading-relaxed text-spectre-magenta">
                    <span className="opacity-60">[{line.time}]</span> 🤖 {line.text}
                  </p>
                ) : (
                  <div
                    className={`max-w-[82%] rounded-md border px-3 py-2 ${
                      line.speaker === "cliente"
                        ? "border-spectre-cyan/25 bg-spectre-cyan/[0.04]"
                        : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="mb-0.5 flex items-center gap-2">
                      <span
                        className={`font-mono text-[9px] uppercase tracking-[0.2em] ${
                          line.speaker === "cliente" ? "text-spectre-cyan" : "text-spectre-text/70"
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
                        line.speaker === "cliente" ? "text-spectre-text" : "text-spectre-text/85"
                      }`}
                    >
                      {line.text}
                    </p>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Interim (live, not yet finalized) */}
          {interim && (
            <div className="flex justify-start">
              <div className="max-w-[82%] rounded-md border border-dashed border-spectre-magenta/30 bg-black/30 px-3 py-2">
                <p className="text-sm italic leading-snug text-spectre-muted">{interim}…</p>
              </div>
            </div>
          )}

          {active && (
            <div className="flex items-center gap-2 px-1 pt-1">
              <PulseRing tone="magenta" size={6} />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted">
                {mode === "live" ? "Ascolto in corso…" : "Trasmissione in corso…"}
              </span>
            </div>
          )}
          {demoFinished && (
            <div className="flex items-center gap-2 px-1 pt-1">
              <Check className="h-3.5 w-3.5 text-spectre-green" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-green">
                Demo terminata
              </span>
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
