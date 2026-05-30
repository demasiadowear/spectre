"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, X } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";

interface VoiceCommandsModalProps {
  open: boolean;
  onClose: () => void;
}

const COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "Apri [Visor | Hunter | Hand | Whisper | Oracle | Mind]", desc: "Naviga tra i moduli" },
  { cmd: "Hunter cerca [categoria] a [città]", desc: "Lancia un hunt — es. parrucchiere a Milano" },
  { cmd: "Genera proposta per [nome]", desc: "Apre Hand sul lead" },
  { cmd: "Simula scenario per [nome]", desc: "Oracle calcola la probabilità" },
  { cmd: "Cerca lead [nome]", desc: "Filtra il Visor per nome" },
  { cmd: "Mostra lead [hot | warm | cold]", desc: "Filtra la pipeline per stato" },
  { cmd: "Leggi [insight | script]", desc: "SPECTRE legge ad alta voce" },
  { cmd: "Scan network", desc: "Mind cerca connessioni nascoste" },
  { cmd: "Stop / Silenzio", desc: "Ferma voce e ascolto" },
  { cmd: "Aiuto", desc: "SPECTRE elenca i comandi" },
];

const BROWSER_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "Cerca su YouTube [cosa]", desc: "Apre una ricerca YouTube" },
  { cmd: "Cerca su Spotify [artista]", desc: "Apre Spotify" },
  { cmd: "Cerca su Google [query]", desc: "Apre una ricerca Google" },
  { cmd: "Apri Calendar / Gmail / Drive / Maps", desc: "Apre il servizio Google" },
  { cmd: "Meteo [città]", desc: "Apre le previsioni" },
];

export default function VoiceCommandsModal({
  open,
  onClose,
}: VoiceCommandsModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-scrim/50 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <GlassCard corners glow="cyan" className="max-h-[80vh] overflow-hidden">
              <div className="flex items-center justify-between border-b border-border p-4">
                <p className="flex items-center gap-2 font-display text-sm font-bold tracking-[0.15em] text-spectre-text">
                  <Mic className="h-4 w-4 text-spectre-cyan" strokeWidth={1.5} />
                  COMANDI VOCALI SPECTRE
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Chiudi"
                  className="text-spectre-muted transition hover:text-spectre-magenta"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto p-4">
                <p className="mb-1 px-3 font-mono text-[9px] uppercase tracking-[0.3em] text-spectre-cyan/70">
                  SPECTRE
                </p>
                <ul>
                  {COMMANDS.map((c) => (
                    <li
                      key={c.cmd}
                      className="border-l-2 border-spectre-cyan/40 px-3 py-2 transition hover:bg-spectre-cyan/10"
                    >
                      <p className="font-mono text-xs text-spectre-cyan">{c.cmd}</p>
                      <p className="font-mono text-[10px] text-spectre-muted">
                        {c.desc}
                      </p>
                    </li>
                  ))}
                </ul>

                <p className="mb-1 mt-4 px-3 font-mono text-[9px] uppercase tracking-[0.3em] text-spectre-magenta/70">
                  Browser
                </p>
                <ul>
                  {BROWSER_COMMANDS.map((c) => (
                    <li
                      key={c.cmd}
                      className="border-l-2 border-spectre-magenta/50 px-3 py-2 transition hover:bg-spectre-magenta/10"
                    >
                      <p className="font-mono text-xs text-spectre-magenta">
                        {c.cmd}
                      </p>
                      <p className="font-mono text-[10px] text-spectre-muted">
                        {c.desc}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
