"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VoiceController } from "@/lib/voice/controller";
import { isSpeechRecognitionSupported } from "@/lib/voice/speech-recognition";
import { useVoiceStore } from "@/lib/voice/store";
import type { VoiceCommand, VoiceStatus } from "@/types/voice";

export interface UseVoice {
  supported: boolean;
  status: VoiceStatus;
  transcript: string;
  interimTranscript: string;
  lastCommand: VoiceCommand | null;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  toggleMute: () => void;
  speak: (text: string) => void;
  submitText: (text: string) => void;
}

/**
 * Single source of voice truth. Instantiate ONCE (in VoiceInterface,
 * which lives in the header) — the controller owns the mic/TTS and
 * survives route changes because the HUD layout never remounts.
 */
export function useVoice(): UseVoice {
  const router = useRouter();
  const publishAction = useVoiceStore((s) => s.publishAction);

  const [supported] = useState(() => isSpeechRecognitionSupported());
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ctrlRef = useRef<VoiceController | null>(null);

  useEffect(() => {
    const ctrl = new VoiceController({
      onStatus: setStatus,
      onTranscript: (final, interim) => {
        if (final) setTranscript(final);
        setInterimTranscript(interim);
      },
      onCommand: setLastCommand,
      onError: setError,
      navigate: (route) => router.push(route),
      publish: publishAction,
      getReadable: () => useVoiceStore.getState().readable,
      openUrl: (url, target, label) => {
        // Voice-triggered window.open is async (not a click) → often blocked.
        // On block, surface a clickable toast so the user opens it via a gesture.
        let win: Window | null = null;
        try {
          win = window.open(url, target);
        } catch {
          win = null;
        }
        if (!win) useVoiceStore.getState().setBlockedUrl({ url, label });
      },
    });
    ctrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      ctrlRef.current = null;
    };
  }, [router, publishAction]);

  return {
    supported,
    status,
    transcript,
    interimTranscript,
    lastCommand,
    error,
    startListening: () => ctrlRef.current?.start(),
    stopListening: () => ctrlRef.current?.stop(),
    toggleMute: () => ctrlRef.current?.toggleMute(),
    speak: (text) => {
      void ctrlRef.current?.speak(text);
    },
    submitText: (text) => ctrlRef.current?.submitText(text),
  };
}
