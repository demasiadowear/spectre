import { create } from "zustand";
import type { VoicePendingAction, VoiceReadable } from "@/types/voice";

// ============================================================
// Voice command bus + readable registry. The voice controller
// publishes actions here; module client components subscribe and
// consume them. Pages register readable text for "leggi ...".
// ============================================================

let nonceSeq = 0;

/** Set when a voice-triggered window.open is blocked by the popup blocker. */
export interface BlockedUrl {
  url: string;
  label: string;
}

interface VoiceStore {
  pendingAction: VoicePendingAction | null;
  readable: VoiceReadable | null;
  blockedUrl: BlockedUrl | null;
  publishAction: (action: Omit<VoicePendingAction, "nonce">) => void;
  consumeAction: () => void;
  setReadable: (readable: VoiceReadable | null) => void;
  setBlockedUrl: (blocked: BlockedUrl | null) => void;
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  pendingAction: null,
  readable: null,
  blockedUrl: null,
  publishAction: (action) =>
    set({ pendingAction: { ...action, nonce: ++nonceSeq } }),
  consumeAction: () => set({ pendingAction: null }),
  setReadable: (readable) => set({ readable }),
  setBlockedUrl: (blockedUrl) => set({ blockedUrl }),
}));
