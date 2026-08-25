"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CandidateBars } from "@/components/predict/CandidateBars";
import { Lattice } from "@/components/predict/Lattice";
import type { Candidate, LatticeNode } from "@/lib/engine/types";
import { useEngine } from "@/lib/useEngine";

const SEEDS = [
  "The first thing you notice about the ocean is",
  "In the winter of 1943, the city was",
  "She opened the letter and read it twice before",
  "The main advantage of this approach is that it",
];

/**
 * The landing page demo.
 *
 * Deliberately does NOT auto-download the model: a 27MB fetch should be the
 * consequence of someone asking for it, not of them scrolling past. The engine
 * starts on the first click or keystroke.
 */
export function LiveDemo() {
  const { engine, status, meta, manifest, error, prediction, latency, start } =
    useEngine(false);

  const [text, setText] = useState(SEEDS[0]);
  const [lattice, setLattice] = useState<LatticeNode[]>([]);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (armed) return;
    setArmed(true);
    void start();
  }, [armed, start]);

  const refresh = useCallback(
    (v: string) => {
      if (!engine || status !== "ready") return;
      engine.predict(v, { topK: 5, temperature: 0.8, window: 128 });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const r = await engine.lattice(v, 4, 2);
        setLattice(r.nodes);
      }, 420);
    },
    [engine, status],
  );

  useEffect(() => {
    if (status === "ready") refresh(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function onChange(v: string) {
    setText(v);
    refresh(v);
  }

  function accept(c: Candidate) {
    onChange(text + c.text);
  }

  const ghost =
    status === "ready" && prediction?.candidates.length
      ? prediction.candidates[0].text
      : "";

  return (
    <div className="ticked border border-[var(--hairline)] bg-[var(--surface-1)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hairline)] px-3 py-2">
        <span className="label">live · in your browser</span>
        <span className="ml-auto flex items-center gap-4 text-[10px] tabular-nums text-[var(--ink-muted)]">
          {status === "ready" && (
            <>
              <span>
                ctx{" "}
                <span className="text-[var(--ink-1)]">
                  {prediction?.contextTokens ?? 0}
                </span>
              </span>
              <span>
                <span className="text-[var(--signal)]">
                  {latency.last.toFixed(1)}
                </span>
                ms
              </span>
              <span>
                H{" "}
                <span className="text-[var(--ink-1)]">
                  {(prediction?.entropy ?? 0).toFixed(2)}
                </span>
                b
              </span>
            </>
          )}
        </span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="relative min-h-[190px] border-b border-[var(--hairline)] lg:border-r lg:border-b-0">
          {!armed ? (
            <button
              onClick={arm}
              className="group flex h-full min-h-[190px] w-full flex-col items-center justify-center gap-3 p-6"
            >
              <span className="border border-[var(--signal)] bg-[var(--signal-wash)] px-4 py-2 text-[11px] tracking-[0.14em] text-[var(--signal)] uppercase transition-colors group-hover:bg-[var(--signal)] group-hover:text-[var(--plane)]">
                ▶ load the model
              </span>
              <span className="max-w-xs text-center text-[11px] leading-relaxed text-[var(--ink-muted)]">
                Downloads once (~27MB), then runs offline. Nothing you type is
                ever sent anywhere.
              </span>
            </button>
          ) : status !== "ready" ? (
            <div className="flex h-full min-h-[190px] flex-col items-center justify-center gap-3 p-6">
              <div className="sweeping relative h-px w-40 overflow-hidden bg-[var(--hairline)]" />
              <span className="label">
                {status === "error" ? "failed" : "loading weights…"}
              </span>
              {error && (
                <span className="max-w-xs text-center text-[10px] text-[var(--critical)]">
                  {error}
                </span>
              )}
            </div>
          ) : (
            <div className="relative h-full">
              <div
                aria-hidden
                className="prose-surface pointer-events-none absolute inset-0 px-4 py-3.5 break-words whitespace-pre-wrap"
              >
                <span className="invisible">{text}</span>
                <span className="ghost">
                  {ghost}
                  <span className="caret text-[var(--signal)]">▌</span>
                </span>
              </div>
              <textarea
                value={text}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && prediction?.candidates.length) {
                    e.preventDefault();
                    accept(prediction.candidates[0]);
                  }
                }}
                spellCheck={false}
                className="prose-surface relative h-full min-h-[190px] w-full resize-none bg-transparent px-4 py-3.5 outline-none"
              />
            </div>
          )}
        </div>

        <div className="p-3">
          <CandidateBars
            candidates={prediction?.candidates ?? []}
            onPick={(c) => accept(c)}
            busy={armed && status !== "ready"}
          />
          {status === "ready" && (
            <p className="mt-3 border-t border-[var(--hairline)] pt-2 text-[10px] leading-relaxed text-[var(--ink-muted)]">
              press <span className="text-[var(--signal)]">tab</span> to accept ·{" "}
              {manifest?.shipped_variant} ·{" "}
              {meta ? (meta.modelBytes / 1e6).toFixed(1) : "—"}MB
            </p>
          )}
        </div>
      </div>

      {status === "ready" && (
        <div className="border-t border-[var(--hairline)] px-2 py-2">
          <Lattice nodes={lattice} />
        </div>
      )}

      {status === "ready" && (
        <div className="flex flex-wrap gap-2 border-t border-[var(--hairline)] px-3 py-2">
          <span className="label self-center">try:</span>
          {SEEDS.map((s) => (
            <button
              key={s}
              onClick={() => onChange(s)}
              className="max-w-[220px] truncate border border-[var(--hairline)] px-2 py-1 text-[10px] text-[var(--ink-2)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
            >
              {s.slice(0, 34)}…
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
