import { create } from "zustand";

// ============================================================
// Lightweight global HUD state. VISOR writes live pipeline stats;
// HUDHeader (in the root layout) reads them. Keeps the server
// layout simple while still showing live counters.
// ============================================================

interface HudStats {
  activeLeads: number;
  dealValueOpen: number;
  negotiatingValue: number;
}

interface HudState extends HudStats {
  setHudStats: (stats: HudStats) => void;
}

export const useHudStore = create<HudState>((set) => ({
  activeLeads: 0,
  dealValueOpen: 0,
  negotiatingValue: 0,
  setHudStats: (stats) => set(stats),
}));
