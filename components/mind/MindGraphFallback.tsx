import type { MindNodeData } from "./ForceGraphCanvas";

// ============================================================
// Static SVG fallback — shown only if the canvas 2D context
// fails to initialise. 8 nodes on a ring, minimal labels.
// ============================================================

interface MindGraphFallbackProps {
  nodes: MindNodeData[];
}

const CX = 200;
const CY = 200;
const RING = 140;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export default function MindGraphFallback({ nodes }: MindGraphFallbackProps) {
  const picked = nodes.slice(0, 8);
  const count = Math.max(picked.length, 1);

  const points = picked.map((n, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return {
      node: n,
      x: CX + Math.cos(angle) * RING,
      y: CY + Math.sin(angle) * RING,
      r: clamp(Math.sqrt(Math.max(1, n.value)) / 2.5, 6, 18),
    };
  });

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <svg viewBox="0 0 400 400" className="h-full max-h-[460px] w-full max-w-[460px]">
        {/* ring connections */}
        {points.map((p, i) => {
          const next = points[(i + 1) % points.length];
          return (
            <line
              key={`ring-${i}`}
              x1={p.x}
              y1={p.y}
              x2={next.x}
              y2={next.y}
              stroke="rgba(0,240,255,0.18)"
              strokeWidth={1}
            />
          );
        })}
        {/* a couple of chords for depth */}
        {points.length > 3 && (
          <>
            <line
              x1={points[0].x}
              y1={points[0].y}
              x2={points[Math.floor(points.length / 2)].x}
              y2={points[Math.floor(points.length / 2)].y}
              stroke="rgba(255,0,110,0.16)"
              strokeWidth={1}
            />
            <line
              x1={points[1].x}
              y1={points[1].y}
              x2={points[points.length - 1].x}
              y2={points[points.length - 1].y}
              stroke="rgba(56,176,0,0.16)"
              strokeWidth={1}
            />
          </>
        )}
        {/* nodes */}
        {points.map((p, i) => (
          <g key={`node-${i}`}>
            <circle cx={p.x} cy={p.y} r={p.r} fill={p.node.color} opacity={0.9} />
            <text
              x={p.x}
              y={p.y + p.r + 12}
              textAnchor="middle"
              fontSize={9}
              fontFamily='"JetBrains Mono", ui-monospace, monospace'
              fill="rgba(224,224,224,0.7)"
            >
              {p.node.company}
            </text>
          </g>
        ))}
      </svg>
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-spectre-muted">
        Modalità statica — canvas non disponibile
      </p>
    </div>
  );
}
