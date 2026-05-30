"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  Maximize2,
  Network,
  Radar,
  X,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import LoadingGrid from "@/components/ui/spectre/LoadingGrid";
import PulseRing from "@/components/ui/spectre/PulseRing";
import StatusBadge from "@/components/ui/spectre/StatusBadge";
import { LEAD_STATUS, RELATION_META, SPECTRE } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import type { Lead, LeadStatus, MindEdge, RelationType } from "@/types";
import ForceGraphCanvas from "./ForceGraphCanvas";
import MindGraphFallback from "./MindGraphFallback";
import type { MindLink, MindNode, MindNodeData } from "./ForceGraphCanvas";

// ============================================================
// SPECTRE MIND — relationship force-graph.
// Shell: 4 status-group filters, RESET VIEW, SCAN NETWORK
// (LoadingGrid → toast → animated new edge), hover tooltip,
// click → 300px detail sidebar. The canvas itself is loaded
// client-only via next/dynamic.
// ============================================================

interface MindGraphProps {
  leads: Lead[];
  edges: MindEdge[];
}

const FILTERS: {
  key: string;
  label: string;
  statuses: LeadStatus[];
  hex: string;
}[] = [
  { key: "cold", label: "Da contattare", statuses: ["todo"], hex: LEAD_STATUS.todo.hex },
  {
    key: "active",
    label: "Attivi",
    statuses: ["step1_sent", "replied", "step2_sent"],
    hex: SPECTRE.cyan,
  },
  {
    key: "deal",
    label: "Trattativa",
    statuses: ["preview_sent", "negotiating"],
    hex: SPECTRE.magenta,
  },
  {
    key: "closed",
    label: "Chiusi",
    statuses: ["closed", "lost"],
    hex: SPECTRE.green,
  },
];

const RELATIONS: RelationType[] = [
  "colleague",
  "competitor",
  "friend",
  "family",
  "investor",
];

function endId(end: MindLink["source"]): string {
  if (end && typeof end === "object") return String(end.id);
  return String(end);
}

export default function MindGraph({ leads, edges }: MindGraphProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FILTERS.map((f) => [f.key, true])),
  );
  const [extraLinks, setExtraLinks] = useState<MindLink[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<MindNodeData | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [canvasFailed, setCanvasFailed] = useState(false);

  const hoverRef = useRef<MindNodeData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----- Build stable graph data -----
  const allNodes = useMemo<MindNode[]>(
    () =>
      leads.map((l) => ({
        id: l.id,
        name: l.name,
        company: l.company,
        status: l.status,
        value: l.value,
        val: Math.max(1.2, Math.sqrt(l.value) / 3),
        color: LEAD_STATUS[l.status].hex,
      })),
    [leads],
  );

  const nodeIds = useMemo(
    () => new Set(allNodes.map((n) => n.id)),
    [allNodes],
  );

  const baseLinks = useMemo<MindLink[]>(
    () =>
      edges
        .filter((e) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
        .map((e) => ({
          source: e.source_id,
          target: e.target_id,
          relation_type: e.relation_type,
          strength: e.strength,
          color: RELATION_META[e.relation_type].hex,
          width: Math.max(1, e.strength / 3),
          evidence: e.evidence,
        })),
    [edges, nodeIds],
  );

  const allLinks = useMemo<MindLink[]>(
    () => [...baseLinks, ...extraLinks],
    [baseLinks, extraLinks],
  );

  const visibleStatuses = useMemo(() => {
    const s = new Set<LeadStatus>();
    for (const f of FILTERS) {
      if (enabled[f.key]) for (const st of f.statuses) s.add(st);
    }
    return s;
  }, [enabled]);

  const visibleNodes = useMemo(
    () => allNodes.filter((n) => visibleStatuses.has(n.status)),
    [allNodes, visibleStatuses],
  );

  const visibleIds = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes],
  );

  const visibleLinks = useMemo(
    () =>
      allLinks.filter(
        (l) => visibleIds.has(endId(l.source)) && visibleIds.has(endId(l.target)),
      ),
    [allLinks, visibleIds],
  );

  // ----- Selection detail -----
  const selectedLead = useMemo(
    () => (selectedId ? (leads.find((l) => l.id === selectedId) ?? null) : null),
    [selectedId, leads],
  );

  const connections = useMemo(() => {
    if (!selectedId) return [];
    return allLinks
      .filter(
        (l) => endId(l.source) === selectedId || endId(l.target) === selectedId,
      )
      .map((l) => {
        const otherId =
          endId(l.source) === selectedId ? endId(l.target) : endId(l.source);
        const other = leads.find((p) => p.id === otherId);
        return {
          id: otherId,
          name: other?.company ?? otherId,
          relation: l.relation_type,
        };
      });
  }, [selectedId, allLinks, leads]);

  // ----- Handlers -----
  const handleHover = useCallback((n: MindNodeData | null) => {
    hoverRef.current = n;
    setHoverNode(n);
  }, []);

  const handleMove = useCallback((e: React.MouseEvent) => {
    if (!hoverRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const toggleFilter = (key: string) =>
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));

  const pickNewEdge = useCallback((): MindLink | null => {
    const pool = visibleNodes;
    if (pool.length < 2) return null;
    const existing = new Set(
      allLinks.map((l) => {
        const a = endId(l.source);
        const b = endId(l.target);
        return a < b ? `${a}|${b}` : `${b}|${a}`;
      }),
    );
    for (let attempt = 0; attempt < 50; attempt++) {
      const a = pool[Math.floor(Math.random() * pool.length)];
      const b = pool[Math.floor(Math.random() * pool.length)];
      if (a.id === b.id) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (existing.has(key)) continue;
      const rel = RELATIONS[Math.floor(Math.random() * RELATIONS.length)];
      const strength = 4 + Math.floor(Math.random() * 5);
      return {
        source: a.id,
        target: b.id,
        relation_type: rel,
        strength,
        color: RELATION_META[rel].hex,
        width: Math.max(1, strength / 3),
        evidence: "Pattern di co-occorrenza rilevato da SPECTRE MIND.",
      };
    }
    return null;
  }, [visibleNodes, allLinks]);

  const scan = useCallback(() => {
    if (scanning) return;
    setScanning(true);
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => {
      const link = pickNewEdge();
      if (link) {
        setExtraLinks((prev) => [...prev, link]);
        setHighlightKey(`${endId(link.source)}->${endId(link.target)}`);
        setToast("Connessione rilevata");
      } else {
        setToast("Nessuna nuova connessione");
      }
      setScanning(false);
    }, 1500);
  }, [scanning, pickNewEdge]);

  // ----- Timers / cleanup -----
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!highlightKey) return;
    const t = setTimeout(() => setHighlightKey(null), 4500);
    return () => clearTimeout(t);
  }, [highlightKey]);

  useEffect(() => {
    return () => {
      if (scanTimer.current) clearTimeout(scanTimer.current);
    };
  }, []);

  return (
    <div className="mt-4 flex flex-col gap-3">
      {/* ---------- TOOLBAR ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const on = enabled[f.key];
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => toggleFilter(f.key)}
                className={`flex items-center gap-2 rounded-sm border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] transition-all ${
                  on
                    ? "border-white/20 bg-white/[0.04] text-spectre-text"
                    : "border-white/10 text-spectre-muted/50"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full transition-opacity"
                  style={{
                    backgroundColor: f.hex,
                    opacity: on ? 1 : 0.25,
                    boxShadow: on ? `0 0 6px ${f.hex}` : "none",
                  }}
                />
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <NeonButton
            variant="ghost"
            size="sm"
            onClick={() => setResetSignal((s) => s + 1)}
          >
            <Maximize2 className="h-3.5 w-3.5" /> Reset view
          </NeonButton>
          <NeonButton
            variant="green"
            filled
            size="sm"
            onClick={scan}
            disabled={scanning}
          >
            <Radar className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scansione…" : "Scan network"}
          </NeonButton>
        </div>
      </div>

      {/* ---------- GRAPH ---------- */}
      <GlassCard
        corners
        glow="green"
        className="relative h-[70vh] min-h-[520px] overflow-hidden"
      >
        <div
          ref={containerRef}
          onMouseMove={handleMove}
          className="h-full w-full"
        >
          {canvasFailed ? (
            <MindGraphFallback nodes={visibleNodes} />
          ) : (
            <ForceGraphCanvas
              nodes={visibleNodes}
              links={visibleLinks}
              onNodeClick={(n) => setSelectedId(n.id)}
              onNodeHover={handleHover}
              selectedId={selectedId}
              highlightKey={highlightKey}
              resetSignal={resetSignal}
              onInitError={() => setCanvasFailed(true)}
            />
          )}
        </div>

        {/* Legend */}
        <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1 font-mono text-[9px] uppercase tracking-[0.15em] text-spectre-muted">
          {RELATIONS.map((r) => (
            <span key={r} className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-4"
                style={{ backgroundColor: RELATION_META[r].hex }}
              />
              {RELATION_META[r].label}
            </span>
          ))}
        </div>

        <span className="pointer-events-none absolute bottom-3 left-4 font-mono text-[9px] uppercase tracking-[0.2em] text-spectre-muted/60">
          {visibleNodes.length} nodi · {visibleLinks.length} connessioni
        </span>

        {/* Scanning overlay */}
        <AnimatePresence>
          {scanning && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-spectre-ink/60 backdrop-blur-sm"
            >
              <LoadingGrid label="SCANSIONE RETE" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hover tooltip */}
        <AnimatePresence>
          {hoverNode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              style={{
                left: Math.min(mouse.x + 14, (containerRef.current?.clientWidth ?? 0) - 200),
                top: mouse.y + 14,
              }}
              className="pointer-events-none absolute z-20 w-[190px] rounded-md border border-spectre-green/30 bg-black/80 p-3 backdrop-blur-xl"
            >
              <p className="font-display text-sm font-bold text-spectre-text">
                {hoverNode.company}
              </p>
              <p className="font-mono text-[10px] text-spectre-muted">
                {hoverNode.name}
              </p>
              <div className="mt-1.5 flex items-center justify-between font-mono text-[10px]">
                <span
                  className="uppercase tracking-[0.15em]"
                  style={{ color: LEAD_STATUS[hoverNode.status].hex }}
                >
                  {LEAD_STATUS[hoverNode.status].label}
                </span>
                <span className="text-spectre-text">
                  {formatCurrency(hoverNode.value)}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Detail sidebar */}
        <AnimatePresence>
          {selectedLead && (
            <motion.aside
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="absolute right-0 top-0 z-30 flex h-full w-[300px] flex-col border-l border-spectre-green/20 bg-spectre-panel/95 backdrop-blur-2xl"
            >
              <div className="flex items-start justify-between border-b border-white/10 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-spectre-green" />
                    <span className="font-display text-base font-bold text-spectre-text">
                      {selectedLead.company}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-spectre-muted">
                    {selectedLead.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Chiudi"
                  className="text-spectre-muted transition-colors hover:text-spectre-magenta"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-col gap-4 overflow-y-auto p-4">
                <div className="flex items-center justify-between">
                  <StatusBadge status={selectedLead.status} />
                  <span className="font-mono text-sm font-bold text-spectre-text">
                    {formatCurrency(selectedLead.value)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                  <div className="rounded-sm border border-white/10 p-2">
                    <span className="block uppercase tracking-[0.15em] text-spectre-muted">
                      Probabilità
                    </span>
                    <span className="text-spectre-text">
                      {selectedLead.probability}%
                    </span>
                  </div>
                  <div className="rounded-sm border border-white/10 p-2">
                    <span className="block uppercase tracking-[0.15em] text-spectre-muted">
                      Connessioni
                    </span>
                    <span className="text-spectre-text">{connections.length}</span>
                  </div>
                </div>

                {selectedLead.next_action && (
                  <div>
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.15em] text-spectre-muted">
                      Prossima azione
                    </span>
                    <p className="text-sm text-spectre-text">
                      {selectedLead.next_action}
                    </p>
                  </div>
                )}

                <div>
                  <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.15em] text-spectre-muted">
                    Rete relazionale
                  </span>
                  {connections.length === 0 ? (
                    <p className="font-mono text-[11px] text-spectre-muted/70">
                      Nessuna connessione registrata.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {connections.map((c, i) => (
                        <li
                          key={`${c.id}-${i}`}
                          className="flex items-center justify-between rounded-sm border border-white/10 px-2.5 py-1.5"
                        >
                          <span className="text-xs text-spectre-text">
                            {c.name}
                          </span>
                          <span
                            className="font-mono text-[9px] uppercase tracking-[0.15em]"
                            style={{ color: RELATION_META[c.relation].hex }}
                          >
                            {RELATION_META[c.relation].label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </GlassCard>

      {/* ---------- TOAST ---------- */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2"
          >
            <div className="flex items-center gap-2 rounded-sm border border-spectre-green/40 bg-spectre-panel/95 px-4 py-2.5 shadow-neon-green backdrop-blur-xl">
              <PulseRing tone="magenta" size={7} />
              <Network className="h-3.5 w-3.5 text-spectre-green" />
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-spectre-green">
                {toast}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
