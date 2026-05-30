"use client";

import { useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { LeadStatus, RelationType } from "@/types";

// ============================================================
// SPECTRE MIND — native Canvas 2D force graph (d3-force).
// Replaces react-force-graph-2d (heavy, chunk-split, fragile).
// No dynamic import needed: this is a plain "use client" component,
// all canvas/window access happens inside effects. ~20 nodes.
// ============================================================

export interface MindNodeData {
  id: string;
  name: string;
  company: string;
  status: LeadStatus;
  value: number;
  val: number;
  color: string;
}

export interface MindLinkData {
  relation_type: RelationType;
  strength: number;
  color: string;
  width: number;
  evidence: string;
}

export type MindNode = MindNodeData & SimulationNodeDatum;
export type MindLink = MindLinkData &
  SimulationLinkDatum<MindNode> & {
    source: string | MindNode;
    target: string | MindNode;
  };

interface ForceGraphCanvasProps {
  nodes: MindNode[];
  links: MindLink[];
  onNodeClick: (node: MindNodeData) => void;
  onNodeHover: (node: MindNodeData | null) => void;
  selectedId: string | null;
  highlightKey: string | null;
  resetSignal: number;
  /** Fired if the 2D context can't be acquired → shell shows a fallback. */
  onInitError?: () => void;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function nodeRadius(n: MindNode): number {
  return clamp(Math.sqrt(Math.max(1, n.value)) / 2.5, 6, 24);
}

function endId(end: string | MindNode): string {
  return typeof end === "object" ? String(end.id) : String(end);
}

export default function ForceGraphCanvas({
  nodes,
  links,
  onNodeClick,
  onNodeHover,
  selectedId,
  highlightKey,
  resetSignal,
  onInitError,
}: ForceGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // ----- Mutable runtime state (kept off React to avoid re-renders) -----
  const simRef = useRef<Simulation<MindNode, MindLink> | null>(null);
  const rafRef = useRef<number>(0);
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const posRef = useRef<
    Map<string, { x: number; y: number; vx: number; vy: number }>
  >(new Map());
  const selectedRef = useRef<string | null>(selectedId);
  const highlightRef = useRef<string | null>(highlightKey);
  const hoverIdRef = useRef<string | null>(null);
  const didFitRef = useRef(false);
  const fitRef = useRef<(() => void) | null>(null);
  const cbRef = useRef({ onNodeClick, onNodeHover, onInitError });

  // Mirror props into refs (no simulation rebuild on these changes).
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    highlightRef.current = highlightKey;
  }, [highlightKey]);
  useEffect(() => {
    cbRef.current = { onNodeClick, onNodeHover, onInitError };
  }, [onNodeClick, onNodeHover, onInitError]);

  // RESET VIEW — re-fit to current node bounds.
  useEffect(() => {
    if (resetSignal === 0) return;
    fitRef.current?.();
  }, [resetSignal]);

  // Measure the container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ----- Simulation + render loop + interaction (rebuilds on data/size) -----
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      cbRef.current.onInitError?.();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    // Seed positions from the previous layout so filter/scan don't reshuffle.
    for (const n of nodes) {
      const p = posRef.current.get(n.id);
      if (p) {
        n.x = p.x;
        n.y = p.y;
        n.vx = p.vx;
        n.vy = p.vy;
      }
    }

    const sim = forceSimulation<MindNode, MindLink>(nodes)
      .force(
        "link",
        forceLink<MindNode, MindLink>(links)
          .id((d) => d.id)
          .distance((l) => 70 + (10 - clamp(l.strength, 0, 10)) * 5)
          .strength((l) => clamp(l.strength / 12, 0.05, 1)),
      )
      .force("charge", forceManyBody<MindNode>().strength(-240))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force("collide", forceCollide<MindNode>().radius((n) => nodeRadius(n) + 6))
      .force("x", forceX<MindNode>(size.w / 2).strength(0.045))
      .force("y", forceY<MindNode>(size.h / 2).strength(0.045))
      .stop();

    function fitToNodes() {
      const placed = nodes.filter(
        (n) => typeof n.x === "number" && typeof n.y === "number",
      );
      if (!placed.length || size.w === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of placed) {
        const r = nodeRadius(n);
        minX = Math.min(minX, (n.x as number) - r);
        minY = Math.min(minY, (n.y as number) - r);
        maxX = Math.max(maxX, (n.x as number) + r);
        maxY = Math.max(maxY, (n.y as number) + r);
      }
      const w = maxX - minX || 1;
      const h = maxY - minY || 1;
      const pad = 70;
      const k = clamp(
        Math.min((size.w - pad * 2) / w, (size.h - pad * 2) / h),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      transformRef.current = {
        k,
        x: size.w / 2 - cx * k,
        y: size.h / 2 - cy * k,
      };
    }
    fitRef.current = fitToNodes;

    // Settle a little, then fit once (first mount only — later rebuilds
    // keep the current camera so toggles/scan don't yank the view).
    for (let i = 0; i < 40; i++) sim.tick();
    if (!didFitRef.current) {
      fitToNodes();
      didFitRef.current = true;
    }

    function draw() {
      if (!ctx) return;
      const t = transformRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Links
      for (const l of links) {
        const s = l.source;
        const tg = l.target;
        if (typeof s !== "object" || typeof tg !== "object") continue;
        if (typeof s.x !== "number" || typeof tg.x !== "number") continue;
        const key = `${endId(l.source)}->${endId(l.target)}`;
        const hot = highlightRef.current !== null && key === highlightRef.current;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y as number);
        ctx.lineTo(tg.x, tg.y as number);
        ctx.globalAlpha = hot ? 1 : 0.4;
        ctx.strokeStyle = hot ? "#ffffff" : l.color;
        ctx.lineWidth = (hot ? l.width + 1.5 : l.width) / t.k;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Nodes
      for (const n of nodes) {
        if (typeof n.x !== "number" || typeof n.y !== "number") continue;
        const r = nodeRadius(n);
        const sel = selectedRef.current === n.id;
        const hov = hoverIdRef.current === n.id;

        if (sel || hov) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3, 0, 2 * Math.PI);
          ctx.strokeStyle = sel ? "#ffffff" : "rgba(255,255,255,0.55)";
          ctx.lineWidth = 1.5 / t.k;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = n.color;
        if (sel || hov) {
          ctx.shadowColor = n.color;
          ctx.shadowBlur = 16 / t.k;
        }
        ctx.fill();
        ctx.shadowBlur = 0;

        if (r > 10 || t.k > 1.2) {
          const fs = 10 / t.k;
          ctx.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = "rgba(224,224,224,0.82)";
          ctx.fillText(n.company, n.x, n.y + r + 2 / t.k);
        }
      }
    }

    const frame = () => {
      sim.tick();
      for (const n of nodes) {
        if (typeof n.x === "number" && typeof n.y === "number") {
          posRef.current.set(n.id, {
            x: n.x,
            y: n.y,
            vx: n.vx ?? 0,
            vy: n.vy ?? 0,
          });
        }
      }
      draw();
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    simRef.current = sim;

    // ----- Interaction -----
    const screenToWorld = (sx: number, sy: number) => {
      const t = transformRef.current;
      return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
    };
    const pickNode = (sx: number, sy: number): MindNode | null => {
      const w = screenToWorld(sx, sy);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (typeof n.x !== "number" || typeof n.y !== "number") continue;
        const r = nodeRadius(n) + 4;
        const dx = w.x - n.x;
        const dy = w.y - n.y;
        if (dx * dx + dy * dy <= r * r) return n;
      }
      return null;
    };

    const interaction = {
      mode: "none" as "none" | "pan" | "drag",
      dragNode: null as MindNode | null,
      pressNode: null as MindNode | null,
      lastX: 0,
      lastY: 0,
      moved: false,
    };

    const localXY = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { sx, sy } = localXY(e);
      const t = transformRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newK = clamp(t.k * factor, MIN_ZOOM, MAX_ZOOM);
      transformRef.current = {
        k: newK,
        x: sx - (sx - t.x) * (newK / t.k),
        y: sy - (sy - t.y) * (newK / t.k),
      };
    };

    const onMouseDown = (e: MouseEvent) => {
      const { sx, sy } = localXY(e);
      const node = pickNode(sx, sy);
      interaction.pressNode = node;
      interaction.moved = false;
      interaction.lastX = e.clientX;
      interaction.lastY = e.clientY;
      if (node) {
        interaction.mode = "drag";
        interaction.dragNode = node;
        node.fx = node.x;
        node.fy = node.y;
        sim.alphaTarget(0.3).restart();
      } else {
        interaction.mode = "pan";
      }
      canvas.style.cursor = "grabbing";
    };

    const onMouseMove = (e: MouseEvent) => {
      const { sx, sy } = localXY(e);
      if (interaction.mode === "drag" && interaction.dragNode) {
        const w = screenToWorld(sx, sy);
        interaction.dragNode.fx = w.x;
        interaction.dragNode.fy = w.y;
        interaction.moved = true;
        return;
      }
      if (interaction.mode === "pan") {
        const t = transformRef.current;
        transformRef.current = {
          ...t,
          x: t.x + (e.clientX - interaction.lastX),
          y: t.y + (e.clientY - interaction.lastY),
        };
        interaction.lastX = e.clientX;
        interaction.lastY = e.clientY;
        interaction.moved = true;
        return;
      }
      // Hover hit-test
      const node = pickNode(sx, sy);
      const id = node ? node.id : null;
      if (id !== hoverIdRef.current) {
        hoverIdRef.current = id;
        cbRef.current.onNodeHover(node);
        canvas.style.cursor = id ? "pointer" : "grab";
      }
    };

    const endInteraction = (e: MouseEvent) => {
      if (interaction.mode === "drag" && interaction.dragNode) {
        interaction.dragNode.fx = null;
        interaction.dragNode.fy = null;
        sim.alphaTarget(0);
      }
      // Treat a press without movement over a node as a click.
      if (!interaction.moved && interaction.pressNode) {
        cbRef.current.onNodeClick(interaction.pressNode);
      }
      interaction.mode = "none";
      interaction.dragNode = null;
      interaction.pressNode = null;
      const { sx, sy } = localXY(e);
      canvas.style.cursor = pickNode(sx, sy) ? "pointer" : "grab";
    };

    const onMouseLeave = () => {
      if (interaction.mode === "drag" && interaction.dragNode) {
        interaction.dragNode.fx = null;
        interaction.dragNode.fy = null;
        sim.alphaTarget(0);
      }
      interaction.mode = "none";
      interaction.dragNode = null;
      interaction.pressNode = null;
      if (hoverIdRef.current !== null) {
        hoverIdRef.current = null;
        cbRef.current.onNodeHover(null);
      }
      canvas.style.cursor = "grab";
    };

    canvas.style.cursor = "grab";
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endInteraction);
    canvas.addEventListener("mouseleave", onMouseLeave);

    return () => {
      cancelAnimationFrame(rafRef.current);
      sim.stop();
      simRef.current = null;
      fitRef.current = null;
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endInteraction);
      canvas.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [nodes, links, size.w, size.h]);

  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block touch-none" />
    </div>
  );
}
