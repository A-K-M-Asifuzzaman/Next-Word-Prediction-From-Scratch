"use client";

import { useMemo, useRef, useState } from "react";

import { formatNumber, type NumberFormat } from "./format";

export type Series = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

/**
 * Multi-series line chart with a crosshair readout.
 *
 * Deliberate constraints: one y-axis only (never a second scale for a second
 * unit -- that is the single most misleading thing a chart can do), 2px marks,
 * recessive grid, and a table view behind a toggle so the data is reachable
 * without relying on colour.
 */
export function LineChart({
  labels,
  series,
  height = 190,
  yFormat = "int",
  yLabel,
  showArea = false,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  yFormat?: NumberFormat;
  yLabel?: string;
  showArea?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [tableView, setTableView] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const PAD = { t: 12, r: 14, b: 22, l: 44 };
  const W = 720;
  const H = height;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const { max, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    const raw = Math.max(1, ...all);
    // Round the axis top to a friendly number so gridlines land on readable
    // values rather than on the data's own maximum.
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const top = Math.ceil(raw / mag) * mag;
    return { max: top, ticks: [0, top / 4, top / 2, (top * 3) / 4, top] };
  }, [series]);

  const n = labels.length;
  const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;

  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");

  const area = (vals: number[]) =>
    `${path(vals)} L${x(vals.length - 1)},${PAD.t + plotH} L${x(0)},${PAD.t + plotH} Z`;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((px - PAD.l) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  }

  const tickEvery = Math.max(1, Math.ceil(n / 7));

  return (
    <div ref={wrapRef} className="relative">
      <div className="mb-2 flex items-center justify-between gap-3">
        {/* Legend is always present for >=2 series; identity never rests on
            colour alone because each entry is also labelled here. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.length > 1 &&
            series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-[2px] w-3"
                  style={{ background: s.color }}
                />
                <span className="text-[11px] text-[var(--ink-2)]">{s.label}</span>
              </span>
            ))}
        </div>
        <button
          type="button"
          onClick={() => setTableView((t) => !t)}
          className="label transition-colors hover:text-[var(--signal)]"
        >
          {tableView ? "chart" : "table"}
        </button>
      </div>

      {tableView ? (
        <div className="max-h-[190px] overflow-auto border border-[var(--hairline)]">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="sticky top-0 bg-[var(--surface-2)]">
              <tr>
                <th className="label px-2 py-1 text-left">x</th>
                {series.map((s) => (
                  <th key={s.key} className="label px-2 py-1 text-right">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={l + i} className="border-t border-[var(--hairline)]">
                  <td className="px-2 py-1 text-[var(--ink-2)]">{l}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-2 py-1 text-right">
                      {formatNumber(s.values[i] ?? 0, yFormat)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none"
          style={{ height }}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${yLabel ?? "value"} over ${n} points`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--hairline)"
                strokeWidth={1}
              />
              <text
                x={PAD.l - 6}
                y={y(t) + 3}
                textAnchor="end"
                className="chart-text-muted"
                fill="var(--ink-muted)"
                fontSize={9}
              >
                {formatNumber(t, yFormat)}
              </text>
            </g>
          ))}

          {labels.map((l, i) =>
            i % tickEvery === 0 || i === n - 1 ? (
              <text
                key={l + i}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                fill="var(--ink-muted)"
                fontSize={9}
              >
                {l}
              </text>
            ) : null,
          )}

          {showArea &&
            series.map((s) => (
              <path
                key={`a-${s.key}`}
                d={area(s.values)}
                fill={s.color}
                opacity={0.1}
              />
            ))}

          {series.map((s) => (
            <path
              key={s.key}
              d={path(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {hover !== null && (
            <>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.t}
                y2={PAD.t + plotH}
                stroke="var(--hairline-2)"
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={`h-${s.key}`}
                  cx={x(hover)}
                  cy={y(s.values[hover] ?? 0)}
                  r={4}
                  fill={s.color}
                  /* 2px surface ring keeps overlapping markers separable. */
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              ))}
            </>
          )}
        </svg>
      )}

      {hover !== null && !tableView && (
        <div
          className="pointer-events-none absolute top-8 z-10 border border-[var(--hairline-2)] bg-[var(--surface-2)] px-2 py-1.5"
          style={{
            left: `${Math.min(78, ((x(hover) - PAD.l) / plotW) * 100)}%`,
          }}
        >
          <div className="label mb-1">{labels[hover]}</div>
          {series.map((s) => (
            <div
              key={s.key}
              className="flex items-center gap-2 text-[11px] tabular-nums"
            >
              <span
                aria-hidden
                className="inline-block h-[2px] w-2.5"
                style={{ background: s.color }}
              />
              <span className="text-[var(--ink-2)]">{s.label}</span>
              <span className="ml-auto text-[var(--ink-1)]">
                {formatNumber(s.values[hover] ?? 0, yFormat)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
