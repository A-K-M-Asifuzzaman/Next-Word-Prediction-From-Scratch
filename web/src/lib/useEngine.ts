"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Engine } from "./engine/client";
import type { EngineMeta, Prediction } from "./engine/types";

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export type ModelManifest = {
  name: string;
  step: number;
  vocab_size: number;
  context_length: number;
  params_total: number;
  params_non_embedding: number;
  shipped_variant: string;
  val?: { loss: number; perplexity: number; top1: number; top3: number; top5: number };
  variants: Record<string, { path: string; bytes: number; ppl_delta_pct: number }>;
};

/**
 * Loads the model once per page and keeps a rolling latency window.
 *
 * The engine is intentionally created lazily on first use rather than at module
 * scope: a 27MB download should start because someone opened the editor, not
 * because a route happened to be prefetched.
 */
export function useEngine(autoStart = true) {
  const engineRef = useRef<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [meta, setMeta] = useState<EngineMeta | null>(null);
  const [manifest, setManifest] = useState<ModelManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);

  const latencies = useRef<number[]>([]);
  const [latency, setLatency] = useState({ last: 0, p50: 0, p95: 0, n: 0 });

  const start = useCallback(async () => {
    if (engineRef.current) return;
    setStatus("loading");
    try {
      const manifestRes = await fetch("/model/model.json");
      if (!manifestRes.ok) throw new Error("model manifest missing");
      const m = (await manifestRes.json()) as ModelManifest;
      setManifest(m);

      const variant = m.variants[m.shipped_variant] ?? m.variants.fp32;
      const engine = new Engine();
      engineRef.current = engine;

      engine.onPrediction = (p) => {
        setPrediction(p);
        const arr = latencies.current;
        arr.push(p.latencyMs);
        if (arr.length > 200) arr.shift();
        const sorted = [...arr].sort((a, b) => a - b);
        setLatency({
          last: p.latencyMs,
          p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
          p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
          n: arr.length,
        });
      };
      engine.onError = (msg) => setError(msg);

      await engine.init({
        modelUrl: `/model/${variant.path}`,
        tokenizerUrl: "/model/tokenizer.json",
        wasmPath: "/ort/",
        contextLength: m.context_length,
      });

      setMeta(engine.meta);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (autoStart) void start();
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    engine: engineRef.current,
    status,
    meta,
    manifest,
    error,
    prediction,
    latency,
    start,
  };
}
