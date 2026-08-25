import { ReactNode } from "react";

/**
 * The base surface. Everything on this site sits in one of these: a hairline
 * box with a labelled header rail and optional bezel ticks. No shadow, no
 * radius beyond 2px, no gradient -- the box reads as an instrument panel
 * because of its rules and its corner marks, not its lighting.
 */
export function Panel({
  label,
  aside,
  children,
  ticked = false,
  className = "",
  bodyClassName = "",
}: {
  label?: string;
  aside?: ReactNode;
  children: ReactNode;
  ticked?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`border border-[var(--hairline)] bg-[var(--surface-1)] ${
        ticked ? "ticked" : ""
      } ${className}`}
    >
      {(label || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] px-3 py-2">
          {label && <span className="label">{label}</span>}
          {aside && <div className="flex items-center gap-3">{aside}</div>}
        </header>
      )}
      <div className={bodyClassName || "p-3"}>{children}</div>
    </section>
  );
}

/** Key/value line as used across every readout in the app. */
export function Readout({
  k,
  v,
  tone = "default",
  mono = true,
}: {
  k: string;
  v: ReactNode;
  tone?: "default" | "signal" | "muted" | "good" | "critical";
  mono?: boolean;
}) {
  const toneClass =
    tone === "signal"
      ? "text-[var(--signal)]"
      : tone === "muted"
        ? "text-[var(--ink-muted)]"
        : tone === "good"
          ? "text-[var(--good)]"
          : tone === "critical"
            ? "text-[var(--critical)]"
            : "text-[var(--ink-1)]";

  return (
    <div className="flex items-baseline justify-between gap-4 py-[3px]">
      <span className="label shrink-0">{k}</span>
      {/* Dotted leader: fills the gap so the eye tracks across to the value. */}
      <span
        aria-hidden
        className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-[var(--hairline)]"
      />
      <span
        className={`shrink-0 text-[12px] tabular-nums ${toneClass} ${
          mono ? "font-mono" : ""
        }`}
      >
        {v}
      </span>
    </div>
  );
}

/**
 * A headline number. Per the dataviz guidance a single big figure is often the
 * right "chart" -- one number, one label, one optional delta, no decoration.
 */
export function StatTile({
  label,
  value,
  unit,
  delta,
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: { value: number; goodWhen: "up" | "down" };
  hint?: string;
}) {
  const good = delta
    ? delta.goodWhen === "up"
      ? delta.value > 0
      : delta.value < 0
    : false;

  return (
    <div className="ticked border border-[var(--hairline)] bg-[var(--surface-1)] p-3">
      <div className="label">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-sans text-[28px] leading-none font-medium tracking-tight tabular-nums">
          {value}
        </span>
        {unit && (
          <span className="text-[11px] text-[var(--ink-muted)]">{unit}</span>
        )}
      </div>
      {delta !== undefined && delta !== null && (
        <div
          className={`mt-1.5 flex items-center gap-1 text-[11px] tabular-nums ${
            good ? "text-[var(--good)]" : "text-[var(--ink-2)]"
          }`}
        >
          {/* Arrow + sign, never colour alone. */}
          <span aria-hidden>{delta.value >= 0 ? "▲" : "▼"}</span>
          <span>
            {delta.value >= 0 ? "+" : ""}
            {delta.value.toFixed(1)}%
          </span>
          <span className="text-[var(--ink-muted)]">vs prev</span>
        </div>
      )}
      {hint && (
        <div className="mt-1.5 text-[11px] leading-snug text-[var(--ink-muted)]">
          {hint}
        </div>
      )}
    </div>
  );
}

/** Status pill. Always carries a glyph so colour is never the only signal. */
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "live" | "good" | "warning" | "critical";
  children: ReactNode;
}) {
  const map = {
    neutral: ["var(--ink-muted)", "·"],
    live: ["var(--signal)", "●"],
    good: ["var(--good)", "✓"],
    warning: ["var(--warning)", "▲"],
    critical: ["var(--critical)", "✕"],
  } as const;
  const [color, glyph] = map[tone];

  return (
    <span
      className="inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[10px] tracking-[0.12em] uppercase"
      style={{ color, borderColor: "var(--hairline)" }}
    >
      <span aria-hidden className={tone === "live" ? "live-dot" : ""}>
        {glyph}
      </span>
      {children}
    </span>
  );
}
