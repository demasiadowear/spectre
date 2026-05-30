import type { TTSOptions } from "@/types/voice";

// ============================================================
// Text-to-speech singleton. Tries the server ElevenLabs route
// (/api/voice/tts) first; on any miss falls back to the browser
// SpeechSynthesis (it-IT). Never overlaps: a new speak() stops the
// previous. onEnd always fires so callers can advance state.
// ============================================================

let currentAudio: HTMLAudioElement | null = null;
let speaking = false;

export function isSpeaking(): boolean {
  return speaking;
}

export function stopSpeaking(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = "";
    } catch {
      /* noop */
    }
    currentAudio = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  speaking = false;
}

function browserTTS(text: string, onEnd?: () => void): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    speaking = false;
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "it-IT";
  const voices = window.speechSynthesis.getVoices();
  const italian = voices.find((v) => v.lang.toLowerCase().includes("it"));
  if (italian) utter.voice = italian;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    speaking = false;
    onEnd?.();
  };
  utter.onend = finish;
  utter.onerror = finish;
  speaking = true;
  window.speechSynthesis.speak(utter);
}

export async function speak(
  text: string,
  options?: TTSOptions,
  onEnd?: () => void,
): Promise<void> {
  stopSpeaking();
  const clean = text?.trim();
  if (!clean) {
    onEnd?.();
    return;
  }
  speaking = true;
  try {
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voiceId: options?.voiceId }),
    });
    const contentType = res.headers.get("Content-Type") ?? "";
    if (res.ok && contentType.includes("audio")) {
      const buf = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      const audio = new Audio(url);
      currentAudio = audio;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        speaking = false;
        onEnd?.();
      };
      audio.onended = finish;
      audio.onerror = finish;
      try {
        await audio.play();
      } catch {
        finish();
        return;
      }
      return;
    }
    // Route signalled fallback (no key) or non-audio response.
    browserTTS(clean, onEnd);
  } catch {
    browserTTS(clean, onEnd);
  }
}
