"use client";

import { useMemo, useState } from "react";

import type { LatticeNode } from "@/lib/engine/types";

/**
 * The branch lattice.
 *
 * A next-word model doesn't pick a word, it induces a tree of possible
 * continuations with a probability on every branch. This draws two levels of
 * that tree: edge weight is the conditional probability of taking the branch,
 * node opacity is the joint probability of the whole path.
 *
 * It is the one view in the app that shows what the model is actually doing
 * rather than what it decided.
 */
export function Lattice({
  nodes,
  onPick,
}: {
  nodes: LatticeNode[];
  onPick?: (path: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const W = 560;
  const H = 240;
  const ROOT_Y = 26;
  const LEVEL_Y = [0, 100, 200];

  const layout = useMemo(() => {
    const d1 = nodes.filter((n) => n.depth === 1);
    const positions = new Map<string, { x: number; y: number }>();

    // Level 1 spreads evenly; level 2 clusters under its parent so the tree
    // reads as branches rather than as a flat grid.
    d1.forEach((n, i) => {
      const x = ((i + 0.5) / Math.max(d1.length, 1)) * W;
      positions.set(n.key, { x, y: LEVEL_Y[1] });
    });

    for (const parent of d1) {
      const kids = nodes.filter((n) => n.parent === parent.key);
      const px = positions.get(parent.key)!.x;
      const span = Math.min(96, W / Math.max(d1.length, 1) - 8);
      kids.forEach((k, j) => {
        const off = kids.length === 1 ? 0 : (j / (kids.length - 1) - 0.5) * span;
        positions.set(k.key, { x: px + off, y: LEVEL_Y[2] });
      });
    }
    return positions;
  }, [nodes]);

  if (!nodes.length) {
    return (
      <p className="py-10 text-center text-[11px] text-[var(--ink-muted)]">
        lattice resolves when typing settles
      </p>
    );
  }

  const rootX = W / 2;
  const isDimmed = (key: string) =>
    hover !== null && !key.startsWith(hover) && !hover.startsWith(key);

  return (
    <svg
      viewBox={`0 0 ${W} ${H + 30}`}
      className="w-full"
      role="img"
      aria-label="Probability tree of the next two tokens"
    >
      {/* faint field marks, so the tree floats on a measured plane */}
      {[0, 1, 2].map((l) => (
        <line
          key={l}
          x1={0}
          x2={W}
          y1={ROOT_Y + LEVEL_Y[l]}
          y2={ROOT_Y + LEVEL_Y[l]}
          stroke="var(--hairline)"
          strokeDasharray="2 6"
        />
      ))}

      <circle cx={rootX} cy={ROOT_Y} r={4} fill="var(--signal)" />
      <text
        x={rootX}
        y={ROOT_Y - 10}
        textAnchor="middle"
        fill="var(--ink-muted)"
        fontSize={9}
        letterSpacing="0.12em"
      >
        CARET
      </text>

      {nodes.map((n) => {
        const pos = layout.get(n.key);
        if (!pos) return null;
        const parentPos =
          n.parent && layout.get(n.parent)
            ? layout.get(n.parent)!
            : { x: rootX, y: ROOT_Y - LEVEL_Y[1] + LEVEL_Y[0] };
        const px = n.parent ? parentPos.x : rootX;
        const py = n.parent ? ROOT_Y + parentPos.y : ROOT_Y;
        const cy = ROOT_Y + pos.y;

        const dim = isDimmed(n.key);
        // Edge weight carries the conditional probability. Floor at 1px so a
        // 2% branch is still visible as a branch.
        const w = Math.max(1, Math.min(6, n.prob * 9));

        return (
          <g
            key={n.key}
            opacity={dim ? 0.22 : 1}
            onPointerEnter={() => setHover(n.key)}
            onPointerLeave={() => setHover(null)}
            onClick={() => onPick?.(n.key)}
            style={{ cursor: onPick ? "pointer" : "default" }}
          >
            <path
              d={`M${px},${py + 6} C${px},${py + 40} ${pos.x},${cy - 40} ${pos.x},${cy - 12}`}
              fill="none"
              stroke={n.depth === 1 ? "var(--series-1)" : "var(--series-3)"}
              strokeWidth={w}
              strokeOpacity={0.5}
              strokeLinecap="round"
            />
            <circle
              cx={pos.x}
              cy={cy - 12}
              r={n.depth === 1 ? 4.5 : 3.5}
              fill={n.depth === 1 ? "var(--series-1)" : "var(--series-3)"}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            <text
              x={pos.x}
              y={cy + 6}
              textAnchor="middle"
              fill={dim ? "var(--ink-muted)" : "var(--ink-1)"}
              fontSize={n.depth === 1 ? 12 : 10.5}
              fontFamily="var(--font-mono)"
            >
              {n.token.trim() || "␣"}
            </text>
            <text
              x={pos.x}
              y={cy + 18}
              textAnchor="middle"
              fill="var(--ink-muted)"
              fontSize={9}
            >
              {(n.prob * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
