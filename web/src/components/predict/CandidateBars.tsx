"use client";

import type { Candidate } from "@/lib/engine/types";

/**
 * The distribution readout: what the model thinks comes next, and how sure it
 * is. This is the honest version of an autocomplete UI -- most products hide
 * the probabilities and show one guess, which makes a 12%-confident suggestion
 * look identical to a 90%-confident one.
 */
export function CandidateBars({
  candidates,
  onPick,
  busy,
}: {
  candidates: Candidate[];
  onPick: (c: Candidate, rank: number) => void;
  busy?: boolean;
}) {
  if (!candidates.length) {
    return (
      <p className="py-8 text-center text-[11px] text-[var(--ink-muted)]">
        {busy ? "measuring…" : "start typing"}
      </p>
    );
  }

  const top = candidates[0].prob;

  return (
    <ul className="space-y-1">
      {candidates.map((c, i) => {
        const pct = (c.prob / top) * 100;
        const display = c.text.replace(/^ /, "␣");
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c, i + 1)}
              className="group grid w-full grid-cols-[1.1rem_minmax(0,1fr)_3.2rem] items-center gap-2 border border-transparent px-1 py-1 text-left transition-colors hover:border-[var(--hairline)] hover:bg-[var(--surface-2)]"
            >
              <kbd className="text-[10px] text-[var(--ink-muted)] group-hover:text-[var(--signal)]">
                {i === 0 ? "⇥" : `⌥${i + 1}`}
              </kbd>

              <span className="relative block">
                {/* The bar is the background of its own label, so the word and
                    its probability occupy one line instead of two. */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 transition-[width] duration-200"
                  style={{
                    width: `${pct}%`,
                    background: i === 0 ? "var(--signal-wash)" : "var(--surface-3)",
                    borderTopRightRadius: 4,
                    borderBottomRightRadius: 4,
                  }}
                />
                <span
                  className={`relative block truncate px-1.5 py-0.5 font-mono text-[13px] ${
                    i === 0 ? "text-[var(--signal)]" : "text-[var(--ink-1)]"
                  }`}
                >
                  {display}
                </span>
              </span>

              <span className="text-right font-mono text-[11px] tabular-nums text-[var(--ink-2)]">
                {(c.prob * 100).toFixed(1)}%
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
