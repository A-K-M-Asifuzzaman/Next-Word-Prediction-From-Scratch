"use client";

import { useState } from "react";

import type { SurprisalToken } from "@/lib/engine/types";

/**
 * Per-token surprisal strip.
 *
 * Each bar is -log2 p(token | everything before it): how many bits that word
 * cost the model. Flat stretches are text the model found predictable; spikes
 * are where you surprised it. Read left to right it is a profile of your own
 * prose against a language model's expectations.
 *
 * Colour is a sequential ramp (one hue, light to dark) because surprisal is a
 * magnitude, not a category.
 */
const RAMP = [
  "var(--seq-1)",
  "var(--seq-2)",
  "var(--seq-3)",
  "var(--seq-4)",
  "var(--seq-5)",
  "var(--seq-6)",
];

// ~14 bits is a rare word; anything above reads as "maximally surprising".
const CEIL = 14;

export function SurprisalScope({
  tokens,
  mean,
}: {
  tokens: SurprisalToken[];
  mean: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (!tokens.length) {
    return (
      <div className="flex h-[76px] items-center justify-center text-[11px] text-[var(--ink-muted)]">
        write a sentence to profile it
      </div>
    );
  }

  const shown = tokens.slice(-160);

  return (
    <div>
      <div
        className="flex h-[76px] items-end gap-[1px] overflow-hidden"
        onPointerLeave={() => setHover(null)}
      >
        {shown.map((t, i) => {
          const norm = Math.min(1, t.surprisal / CEIL);
          const step = Math.min(RAMP.length - 1, Math.floor(norm * RAMP.length));
          return (
            <span
              key={i}
              onPointerEnter={() => setHover(i)}
              className="min-w-[2px] flex-1 transition-opacity"
              style={{
                height: `${Math.max(3, norm * 100)}%`,
                background: RAMP[step],
                opacity: hover === null || hover === i ? 1 : 0.4,
                borderTopLeftRadius: 2,
                borderTopRightRadius: 2,
              }}
              title={`${t.text.trim() || "␣"} · ${t.surprisal.toFixed(2)} bits`}
            />
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-[var(--hairline)] pt-2">
        <span className="label">
          {hover !== null ? (
            <>
              <span className="text-[var(--ink-1)]">
                {shown[hover].text.trim() || "␣"}
              </span>{" "}
              · {shown[hover].surprisal.toFixed(2)} bits
            </>
          ) : (
            `${tokens.length} tokens profiled`
          )}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[var(--ink-2)]">
          mean {mean.toFixed(2)} bits · ppl {Math.pow(2, mean).toFixed(1)}
        </span>
      </div>
    </div>
  );
}
