import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  type SREvent,
  type SRInstance,
} from "./speech-recognition";
import { speak as ttsSpeak, stopSpeaking } from "./tts";
import { parseCommand } from "./commands";
import type {
  AyroAction,
  AyroResponse,
  VoiceCommand,
  VoiceCommandType,
  VoicePendingAction,
  VoiceReadable,
  VoiceStatus,
} from "@/types/voice";

// ============================================================
// VoiceController — imperative state machine, framework-agnostic.
// Owns the SpeechRecognition instance + TTS lifecycle and the
// listen → process → speak → listen loop. React talks to it only
// through the injected callbacks. One instance lives in the header.
// ============================================================

const HELP_TEXT =
  "Puoi parlarmi naturale: chiedimi quanti lead devi chiamare oggi, com'è messo un deal, quanto hai in pipeline. Oppure dammi comandi: apri Cockpit, Visor, Hunter, Hand, Oracle, Territorio o Forecast. Cerca ristoranti a Bari. Genera proposta per Rossi. Simula scenario per Rossi. Posso aprire anche YouTube, Google, Calendar o il meteo. Di' stop per fermarmi.";

const SPEAK_TIMEOUT_MS = 15000;

export interface VoiceControllerCallbacks {
  onStatus: (status: VoiceStatus) => void;
  onTranscript: (final: string, interim: string) => void;
  onCommand: (command: VoiceCommand) => void;
  onError: (error: string | null) => void;
  navigate: (route: string) => void;
  publish: (action: Omit<VoicePendingAction, "nonce">) => void;
  getReadable: () => VoiceReadable | null;
  openUrl: (url: string, target: string, label: string) => void;
}

export class VoiceController {
  private rec: SRInstance | null = null;
  private muted = false;
  private wantListen = false;
  private status: VoiceStatus = "idle";
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly cb: VoiceControllerCallbacks) {}

  isSupported(): boolean {
    return isSpeechRecognitionSupported();
  }

  private setStatus(s: VoiceStatus): void {
    this.status = s;
    this.cb.onStatus(s);
  }

  private clearRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private detach(rec: SRInstance): void {
    rec.onstart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
  }

  private killRec(): void {
    this.clearRestart();
    if (this.rec) {
      const rec = this.rec;
      this.rec = null;
      try {
        this.detach(rec);
        rec.stop();
      } catch {
        /* noop */
      }
    }
  }

  private startRec(): void {
    this.killRec();
    const rec = createSpeechRecognition();
    if (!rec) {
      this.cb.onError("Riconoscimento vocale non supportato.");
      this.setStatus("idle");
      return;
    }
    this.rec = rec;
    rec.onstart = () => {
      if (!this.muted) this.setStatus("listening");
    };
    rec.onresult = (e) => this.onResult(e);
    rec.onerror = (e) => this.onRecError(e.error);
    rec.onend = () => this.onEnd();
    try {
      rec.start();
    } catch {
      /* start() throws if called while already starting — ignore */
    }
  }

  private onResult(e: SREvent): void {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const alt = result[0];
      const text = alt ? alt.transcript : "";
      if (result.isFinal) final += text;
      else interim += text;
    }
    if (interim) this.cb.onTranscript("", interim);
    const trimmed = final.trim();
    if (trimmed) {
      this.cb.onTranscript(trimmed, "");
      void this.handleFinal(trimmed);
    }
  }

  private onRecError(err: string): void {
    if (err === "no-speech" || err === "aborted") return;
    if (
      err === "not-allowed" ||
      err === "service-not-allowed" ||
      err === "audio-capture"
    ) {
      this.wantListen = false;
      this.muted = true;
      this.cb.onError("Microfono non disponibile o permesso negato.");
      this.setStatus("muted");
      return;
    }
    this.cb.onError(`Errore vocale: ${err}`);
  }

  private onEnd(): void {
    // Always-on: auto-restart after a short gap, unless we paused on purpose.
    if (this.wantListen && !this.muted && this.status === "listening") {
      this.clearRestart();
      this.restartTimer = setTimeout(() => this.startRec(), 500);
    }
  }

  private async handleFinal(text: string): Promise<void> {
    // Pause recognition while acting + speaking (prevents TTS echo).
    this.killRec();
    this.setStatus("processing");

    const command = parseCommand(text);
    this.cb.onCommand(command);

    if (command.type === "control") {
      stopSpeaking();
      this.wantListen = false;
      this.muted = true;
      this.setStatus("muted");
      return;
    }

    // Free-form request the regex didn't catch → hand to the AYRO agent
    // (Gemini): it answers data questions and can trigger actions.
    if (command.type === "unknown") {
      const ayro = await this.askAyro(text);
      if (ayro) {
        if (ayro.action && ayro.action.type !== "none") {
          this.execute(this.ayroToCommand(ayro.action));
        }
        if (ayro.speak.trim()) await this.speakInternal(ayro.speak);
        else this.afterSpeak();
        return;
      }
    }

    const responseText = this.execute(command);
    if (responseText.trim()) {
      await this.speakInternal(responseText);
    } else {
      this.afterSpeak();
    }
  }

  private async askAyro(text: string): Promise<AyroResponse | null> {
    try {
      const res = await fetch("/api/ai/ayro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const json = (await res.json()) as {
        success: boolean;
        data?: AyroResponse;
      };
      return json.success && json.data ? json.data : null;
    } catch {
      return null;
    }
  }

  private ayroToCommand(action: AyroAction): VoiceCommand {
    return {
      type: action.type as VoiceCommandType,
      payload: action.payload ?? {},
      responseText: "",
    };
  }

  private execute(command: VoiceCommand): string {
    switch (command.type) {
      case "navigate": {
        const route = String(command.payload.route ?? "");
        if (route) this.cb.navigate(route);
        return command.responseText;
      }
      case "hunt": {
        this.cb.publish({ module: "hunter", kind: "hunt", payload: command.payload });
        this.cb.navigate("/hunter");
        return command.responseText;
      }
      case "generate": {
        this.cb.publish({ module: "hand", kind: "generate", payload: command.payload });
        this.cb.navigate("/hand");
        return command.responseText;
      }
      case "simulate": {
        this.cb.publish({ module: "oracle", kind: "simulate", payload: command.payload });
        this.cb.navigate("/oracle");
        return command.responseText;
      }
      case "search": {
        this.cb.publish({ module: "visor", kind: "search", payload: command.payload });
        this.cb.navigate("/visor");
        return command.responseText;
      }
      case "filter": {
        this.cb.publish({ module: "visor", kind: "filter", payload: command.payload });
        this.cb.navigate("/visor");
        return command.responseText;
      }
      case "browser": {
        const url = String(command.payload.url ?? "");
        const target = String(command.payload.target ?? "_blank");
        const label = String(command.payload.name ?? "il link");
        if (url) this.cb.openUrl(url, target, label);
        return command.responseText;
      }
      case "action": {
        const mod = String(command.payload.module ?? "");
        const kind = String(command.payload.kind ?? "");
        if (mod) {
          this.cb.publish({
            module: mod as VoicePendingAction["module"],
            kind,
            payload: command.payload,
          });
          this.cb.navigate(`/${mod}`);
        }
        return command.responseText;
      }
      case "read": {
        const readable = this.cb.getReadable();
        if (readable && readable.text.trim()) return readable.text;
        return "Non c'è niente da leggere in questa schermata.";
      }
      case "help":
        return HELP_TEXT;
      case "wake":
        return command.responseText;
      default:
        return command.responseText;
    }
  }

  private async speakInternal(text: string): Promise<void> {
    this.setStatus("speaking");
    await Promise.race([
      new Promise<void>((resolve) => ttsSpeak(text, {}, resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, SPEAK_TIMEOUT_MS)),
    ]);
    this.afterSpeak();
  }

  private afterSpeak(): void {
    if (this.wantListen && !this.muted) this.startRec();
    else this.setStatus(this.muted ? "muted" : "idle");
  }

  // -------- Public controls --------

  start(): void {
    this.muted = false;
    this.wantListen = true;
    this.cb.onError(null);
    this.startRec();
  }

  stop(): void {
    this.wantListen = false;
    this.killRec();
    stopSpeaking();
    this.setStatus("idle");
  }

  toggleMute(): void {
    if (this.status === "muted" || !this.wantListen) {
      this.start();
    } else {
      this.muted = true;
      this.wantListen = false;
      this.killRec();
      stopSpeaking();
      this.setStatus("muted");
    }
  }

  /** Run a command from typed text (fallback when STT unsupported). */
  submitText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.cb.onTranscript(trimmed, "");
    void this.handleFinal(trimmed);
  }

  async speak(text: string): Promise<void> {
    await this.speakInternal(text);
  }

  dispose(): void {
    this.wantListen = false;
    this.killRec();
    stopSpeaking();
  }
}
