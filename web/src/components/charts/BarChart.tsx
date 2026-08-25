"use client";

import { useState } from "react";

import { formatNumber, type NumberFormat } from "./format";

export type Bar = {
  label: string;
  value: number;
  /** Optional secondary value drawn as an inset track (e.g. accepted / shown). */
  sub?: number;
  color?: string;
};

/**
 * Horizontal bars. Horizontal because these are ranked categories with text
 * labels -- rotated labels on a vertical bar chart are a readability tax for
 * no gain.
 *
 * Every bar is directly labelled with its value, which is also the required
 * relief for the light-mode contrast warning on this palette.
 */
export function BarChart({
  bars,
  format = "int",
  color = "var(--series-1)",
  subColor = "var(--series-3)",
  subLabel,
  mainLabel,
  emptyNote = "no data yet",
}: {
  bars: Bar[];
  format?: NumberFormat;
  color?: string;
  subColor?: string;
  subLabel?: string;
  mainLabel?: string;
  emptyNote?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));

  if (!bars.length) {
    return (
      <p className="py-6 text-center text-[11px] text-[var(--ink-muted)]">
        {emptyNote}
      </p>
    );
  }

  return (
    <div>
      {subLabel && (
        <div className="mb-2 flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-2"
              style={{ background: color }}
            />
            <span className="text-[11px] text-[var(--ink-2)]">{mainLabel}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-2"
              style={{ background: subColor }}
            />
            <span className="text-[11px] text-[var(--ink-2)]">{subLabel}</span>
          </span>
        </div>
      )}

      <ul className="space-y-1.5">
        {bars.map((b, i) => {
          const pct = (b.value / max) * 100;
          const subPct = b.sub != null ? (b.sub / max) * 100 : null;
          return (
            <li
              key={b.label + i}
              className="group grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            >
              <span
                className="truncate font-mono text-[11px] text-[var(--ink-2)]"
                title={b.label}
              >
                {b.label}
              </span>

              <span className="relative block h-4 bg-[var(--surface-2)]">
                <span
                  className="absolute inset-y-0 left-0 transition-[width] duration-300"
                  style={{
                    width: `${pct}%`,
                    background: b.color ?? color,
                    /* 4px rounded data-end, anchored flat at the baseline. */
                    borderTopRightRadius: 4,
                    borderBottomRightRadius: 4,
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }}
                />
                {subPct != null && (
                  <span
                    className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2"
                    style={{
                      width: `${subPct}%`,
                      background: subColor,
                      /* 2px surface gap so the inset track never merges
                         visually with the bar it sits inside. */
                      boxShadow: "0 0 0 2px var(--surface-1)",
                      borderTopRightRadius: 4,
                      borderBottomRightRadius: 4,
                    }}
                  />
                )}
              </span>

              <span className="w-16 text-right font-mono text-[11px] tabular-nums text-[var(--ink-1)]">
                {formatNumber(b.value, format)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
