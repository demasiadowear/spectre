import { SPECTRE } from "@/lib/constants";

export interface RadarAxis {
  label: string;
  /** 0–100. */
  value: number;
}

interface RadarChartProps {
  data: RadarAxis[];
  size?: number;
  color?: string;
}

/** Minimal SVG radar chart for multi-factor lead scoring. */
export default function RadarChart({
  data,
  size = 180,
  color = SPECTRE.cyan,
}: RadarChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26;
  const n = Math.max(data.length, 3);

  const pointAt = (index: number, radius: number) => {
    const angle = (Math.PI * 2 * index) / n - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  };

  const rings = [0.33, 0.66, 1];

  const shape = data
    .map((axis, i) => {
      const p = pointAt(i, (Math.min(100, Math.max(0, axis.value)) / 100) * r);
      return `${p.x},${p.y}`;
    })
    .join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* grid rings */}
      {rings.map((ratio, ri) => (
        <polygon
          key={ri}
          points={data
            .map((_, i) => {
              const p = pointAt(i, r * ratio);
              return `${p.x},${p.y}`;
            })
            .join(" ")}
          fill="none"
          stroke="rgba(0,240,255,0.12)"
          strokeWidth={1}
        />
      ))}
      {/* spokes */}
      {data.map((_, i) => {
        const p = pointAt(i, r);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="rgba(0,240,255,0.12)"
            strokeWidth={1}
          />
        );
      })}
      {/* value shape */}
      <polygon
        points={shape}
        fill={color}
        fillOpacity={0.18}
        stroke={color}
        strokeWidth={1.5}
      />
      {data.map((axis, i) => {
        const p = pointAt(i, r);
        const lp = pointAt(i, r + 14);
        return (
          <g key={axis.label}>
            <circle cx={p.x} cy={p.y} r={2} fill={color} />
            <text
              x={lp.x}
              y={lp.y}
              fill="rgba(224,224,224,0.6)"
              fontSize={8}
              fontFamily="monospace"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}
            >
              {axis.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
