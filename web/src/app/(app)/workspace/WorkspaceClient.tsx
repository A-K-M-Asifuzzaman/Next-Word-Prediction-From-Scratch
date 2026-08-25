"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BarChart } from "@/components/charts/BarChart";
import { Panel, Pill, Readout } from "@/components/instrument/Panel";
import { CandidateBars } from "@/components/predict/CandidateBars";
import { Composer } from "@/components/predict/Composer";
import { Lattice } from "@/components/predict/Lattice";
import { SurprisalScope } from "@/components/predict/SurprisalScope";
import type { Candidate, LatticeNode, SurprisalToken } from "@/lib/engine/types";
import { createClient } from "@/lib/supabase/client";
import { telemetry } from "@/lib/telemetry";
import { useEngine } from "@/lib/useEngine";

type Doc = {
  id: string;
  title: string;
  word_count: number;
  updated_at: string;
};

type Prefs = {
  temperature: number;
  top_k: number;
  ghost_text: boolean;
  telemetry: boolean;
};

const SETTLE_MS = 420; // how long typing must pause before the heavy views run
const SAVE_MS = 1500;

export function WorkspaceClient({
  userId,
  prefs: initialPrefs,
  documents,
  activeModelId,
}: {
  userId: string;
  prefs: Prefs;
  documents: Doc[];
  activeModelId: string | null;
}) {
  const { engine, status, meta, manifest, error, prediction, latency } = useEngine();

  const [docs, setDocs] = useState<Doc[]>(documents);
  const [docId, setDocId] = useState<string | null>(documents[0]?.id ?? null);
  const [title, setTitle] = useState(documents[0]?.title ?? "Untitled");
  const [text, setText] = useState("");
  const [prefs, setPrefs] = useState(initialPrefs);

  const [lattice, setLattice] = useState<LatticeNode[]>([]);
  const [surprisal, setSurprisal] = useState<{
    tokens: SurprisalToken[];
    mean: number;
  }>({ tokens: [], mean: 0 });
  const [extending, setExtending] = useState(false);

  const [accepted, setAccepted] = useState(0);
  const [shown, setShown] = useState(0);
  const [charsSaved, setCharsSaved] = useState(0);

  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loggedFor = useRef<string>("");

  useEffect(() => {
    telemetry.configure(userId, prefs.telemetry);
  }, [userId, prefs.telemetry]);

  // A client-side route change (nav link, router.push) fires neither pagehide
  // nor visibilitychange, so leaving the workspace for the dashboard would
  // otherwise discard the whole session's buffered events -- and the dashboard
  // would then render zeros for the writing you just did.
  useEffect(() => {
    return () => {
      void telemetry.flush(true);
    };
  }, []);

  /* ---------------------------------------------------------------- doc io */

  const loadDoc = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("documents")
      .select("id, title, content")
      .eq("id", id)
      .single();
    if (data) {
      setDocId(data.id);
      setTitle(data.title);
      setText(data.content ?? "");
    }
  }, []);

  useEffect(() => {
    if (documents[0]) void loadDoc(documents[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(
    async (nextText: string, nextTitle: string) => {
      const supabase = createClient();
      if (docId) {
        await supabase
          .from("documents")
          .update({ content: nextText, title: nextTitle })
          .eq("id", docId);
      } else {
        const { data } = await supabase
          .from("documents")
          .insert({ user_id: userId, content: nextText, title: nextTitle })
          .select("id, title, word_count, updated_at")
          .single();
        if (data) {
          setDocId(data.id);
          setDocs((d) => [data as Doc, ...d]);
        }
      }
    },
    [docId, userId],
  );

  async function newDoc() {
    await telemetry.flush();
    setDocId(null);
    setTitle("Untitled");
    setText("");
    setLattice([]);
    setSurprisal({ tokens: [], mean: 0 });
  }

  /* ------------------------------------------------------------ prediction */

  const runSettled = useCallback(
    async (value: string) => {
      if (!engine || status !== "ready" || value.trim().length < 2) return;
      // Lattice costs several forward passes and surprisal costs one over the
      // whole document, so both wait for a real pause in typing.
      const [lat, sur] = await Promise.all([
        engine.lattice(value, 4, 2),
        engine.surprisal(value),
      ]);
      setLattice(lat.nodes);
      setSurprisal({ tokens: sur.tokens, mean: sur.meanSurprisal });
    },
    [engine, status],
  );

  const onChange = useCallback(
    (v: string) => {
      setText(v);

      if (engine && status === "ready") {
        engine.predict(v, {
          topK: prefs.top_k,
          temperature: prefs.temperature,
          window: 128,
        });
      }

      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => void runSettled(v), SETTLE_MS);

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(v, title), SAVE_MS);
    },
    [engine, status, prefs.top_k, prefs.temperature, runSettled, save, title],
  );

  // Log one telemetry row per suggestion that actually settled on screen.
  useEffect(() => {
    if (!prediction?.candidates.length) return;
    const key = `${text.length}:${prediction.candidates[0].id}`;
    if (loggedFor.current === key) return;
    const t = setTimeout(() => {
      loggedFor.current = key;
      setShown((s) => s + 1);
      telemetry.record({
        document_id: docId,
        model_id: activeModelId,
        latency_ms: Number(prediction.latencyMs.toFixed(3)),
        context_tokens: prediction.contextTokens,
        top1_token: prediction.candidates[0].text.slice(0, 64),
        top1_prob: Number(prediction.candidates[0].prob.toFixed(5)),
        entropy: Number(prediction.entropy.toFixed(5)),
        accepted: false,
        accepted_rank: null,
        chars_saved: 0,
        source: "browser",
      });
    }, 300);
    return () => clearTimeout(t);
  }, [prediction, text.length, docId, activeModelId]);

  const onAccept = useCallback((c: Candidate, rank: number) => {
    setAccepted((a) => a + 1);
    setCharsSaved((s) => s + c.text.length);
    telemetry.markAccepted(rank, c.text.length);
  }, []);

  const pickCandidate = useCallback(
    (c: Candidate, rank: number) => {
      const next = text + c.text;
      onChange(next);
      onAccept(c, rank);
    },
    [text, onChange, onAccept],
  );

  async function extend() {
    if (!engine || status !== "ready") return;
    setExtending(true);
    try {
      const r = await engine.continuation(text, 12, prefs.temperature);
      onChange(text + r.text);
    } finally {
      setExtending(false);
    }
  }

  /* ---------------------------------------------------------------- derived */

  const acceptRate = shown ? (accepted / shown) * 100 : 0;
  const words = useMemo(
    () => (text.trim() ? text.trim().split(/\s+/).length : 0),
    [text],
  );

  const entropyBars = useMemo(
    () =>
      (prediction?.candidates ?? []).slice(0, 5).map((c) => ({
        label: c.text.replace(/^ /, "␣") || "␣",
        value: Number((c.prob * 100).toFixed(1)),
      })),
    [prediction],
  );

  const loading = status === "loading" || status === "idle";

  return (
    <main className="grid-plane min-h-[calc(100dvh-2.75rem)]">
      {/* ------------------------------------------------------ status rail */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--hairline)] bg-[var(--surface-1)] px-4 py-2">
        <Pill tone={status === "ready" ? "live" : status === "error" ? "critical" : "neutral"}>
          {status === "ready" ? "live" : status === "error" ? "failed" : "loading"}
        </Pill>

        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(
              () => void save(text, e.target.value),
              SAVE_MS,
            );
          }}
          className="max-w-[220px] min-w-0 flex-1 border-b border-transparent bg-transparent font-sans text-[13px] outline-none focus:border-[var(--hairline-2)]"
          aria-label="Document title"
        />

        <div className="flex items-center gap-4 text-[11px] tabular-nums text-[var(--ink-muted)]">
          <span>
            ctx{" "}
            <span className="text-[var(--ink-1)]">
              {prediction?.contextTokens ?? 0}
            </span>
            tok
          </span>
          <span>
            lat{" "}
            <span className="text-[var(--ink-1)]">
              {latency.last.toFixed(1)}
            </span>
            ms
          </span>
          <span className="hidden sm:inline">
            p95{" "}
            <span className="text-[var(--ink-1)]">{latency.p95.toFixed(1)}</span>
            ms
          </span>
          <span className="hidden md:inline">
            {words}w · {accepted}/{shown} taken
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button onClick={newDoc} className="label hover:text-[var(--signal)]">
            + new
          </button>
          {docs.length > 0 && (
            <select
              value={docId ?? ""}
              onChange={(e) => void loadDoc(e.target.value)}
              className="max-w-[150px] border border-[var(--hairline)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] outline-none"
              aria-label="Open document"
            >
              {!docId && <option value="">unsaved</option>}
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div className="border-b border-[var(--critical)] bg-[var(--surface-1)] px-4 py-2 text-[11px] text-[var(--critical)]">
          engine error: {error}
        </div>
      )}

      {/* The instrument column is taller than the editor needs to be, so the
          row gets a fixed height and the column scrolls inside itself. Without
          this the editor stretches to match and pushes the surprisal scope
          off-screen, which is the one view that reads the whole document. */}
      <div className="grid gap-px lg:h-[calc(100dvh-15rem)] lg:min-h-[430px] lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* -------------------------------------------------------- editor */}
        <div className="relative flex min-h-[52vh] flex-col overflow-hidden border-b border-[var(--hairline)] bg-[var(--surface-1)] lg:min-h-0 lg:border-r lg:border-b-0">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--surface-1)]">
              <div className="sweeping relative h-px w-40 overflow-hidden bg-[var(--hairline)]" />
              <p className="label">downloading model · one time, then cached</p>
              <p className="max-w-xs text-center text-[11px] text-[var(--ink-muted)]">
                {manifest
                  ? `${manifest.name} · ${(
                      (manifest.variants[manifest.shipped_variant]?.bytes ?? 0) / 1e6
                    ).toFixed(1)}MB · ${manifest.shipped_variant}`
                  : "fetching manifest…"}
              </p>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <Composer
              value={text}
              onChange={onChange}
              prediction={prediction}
              onAccept={onAccept}
              ghostEnabled={prefs.ghost_text}
              disabled={status !== "ready"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--hairline)] px-4 py-2 text-[10px] tracking-[0.1em] text-[var(--ink-muted)] uppercase">
            <span>
              <span className="text-[var(--signal)]">tab</span> accept
            </span>
            <span>
              <span className="text-[var(--signal)]">⌥2–5</span> alternates
            </span>
            <button
              onClick={extend}
              disabled={extending || status !== "ready"}
              className="hover:text-[var(--signal)] disabled:opacity-40"
            >
              <span className="text-[var(--signal)]">↳</span>{" "}
              {extending ? "extending…" : "extend 12"}
            </button>
            <label className="ml-auto flex items-center gap-2 normal-case">
              <span>temp {prefs.temperature.toFixed(2)}</span>
              <input
                type="range"
                min={0.1}
                max={1.5}
                step={0.05}
                value={prefs.temperature}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, temperature: Number(e.target.value) }))
                }
                className="w-20 accent-[var(--signal)]"
                aria-label="Sampling temperature"
              />
            </label>
          </div>
        </div>

        {/* --------------------------------------------------- instruments */}
        <aside className="flex flex-col gap-px overflow-y-auto bg-[var(--hairline)]">
          <Panel
            label="distribution"
            aside={
              <span className="text-[10px] tabular-nums text-[var(--ink-muted)]">
                top-{prefs.top_k}
              </span>
            }
          >
            <CandidateBars
              candidates={prediction?.candidates ?? []}
              onPick={pickCandidate}
              busy={status !== "ready"}
            />
          </Panel>

          <Panel label="readout">
            <Readout
              k="entropy"
              v={`${(prediction?.entropy ?? 0).toFixed(2)} bits`}
              tone="signal"
            />
            <Readout
              k="top surprisal"
              v={`${(prediction?.topSurprisal ?? 0).toFixed(2)} bits`}
            />
            <Readout
              k="effective choices"
              v={Math.round(Math.pow(2, prediction?.entropy ?? 0)).toLocaleString()}
            />
            <Readout k="accept rate" v={`${acceptRate.toFixed(0)}%`} />
            <Readout k="chars saved" v={charsSaved.toLocaleString()} />
            <div className="rule my-2" />
            <Readout
              k="model"
              v={manifest ? `${manifest.name}·${manifest.shipped_variant}` : "—"}
              tone="muted"
            />
            <Readout
              k="params"
              v={
                manifest
                  ? `${(manifest.params_total / 1e6).toFixed(2)}M`
                  : "—"
              }
              tone="muted"
            />
            <Readout
              k="weights"
              v={meta ? `${(meta.modelBytes / 1e6).toFixed(1)}MB` : "—"}
              tone="muted"
            />
            <Readout k="runtime" v={meta ? `wasm·${meta.loadMs}ms` : "—"} tone="muted" />
          </Panel>

          <Panel
            label="lattice"
            aside={<span className="label">depth 2</span>}
            bodyClassName="p-2"
          >
            <Lattice nodes={lattice} />
          </Panel>

          <Panel label="top-5 mass" bodyClassName="p-3">
            <BarChart
              bars={entropyBars}
              format="pctOfUnit"
              emptyNote="awaiting first prediction"
            />
          </Panel>
        </aside>
      </div>

      {/* ------------------------------------------------------------ scope */}
      <Panel
        label="surprisal scope"
        aside={
          <span className="text-[10px] text-[var(--ink-muted)]">
            bits per token · low = predictable
          </span>
        }
        className="border-x-0 border-b-0"
      >
        <SurprisalScope tokens={surprisal.tokens} mean={surprisal.mean} />
      </Panel>
    </main>
  );
}
