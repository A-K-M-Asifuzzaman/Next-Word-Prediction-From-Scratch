"use client";

import { useState } from "react";

import { Panel, Pill, Readout } from "@/components/instrument/Panel";
import { compact, nf, relative } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type Model = {
  id: string;
  name: string;
  version: string;
  quantization: string;
  architecture: Record<string, unknown>;
  params_total: number | null;
  params_non_embedding: number | null;
  vocab_size: number | null;
  context_length: number | null;
  train_tokens: number | null;
  val_loss: number | null;
  perplexity: number | null;
  top1: number | null;
  top3: number | null;
  top5: number | null;
  artifact_path: string | null;
  size_bytes: number | null;
  status: "candidate" | "active" | "archived";
  traffic_pct: number;
  notes: string | null;
  created_at: string;
};

export function ModelsClient({ initial }: { initial: Model[] }) {
  const [models, setModels] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function activate(id: string) {
    setError(null);
    const supabase = createClient();
    // One RPC so demoting the incumbent and promoting the challenger happen in
    // a single transaction -- there is never a moment with two active models.
    const { error } = await supabase.rpc("admin_activate_model", { target: id });
    if (error) {
      setError(error.message);
      return;
    }
    setModels((ms) =>
      ms.map((m) => ({
        ...m,
        status: m.id === id ? "active" : m.status === "active" ? "archived" : m.status,
        traffic_pct: m.id === id ? 100 : 0,
      })),
    );
  }

  const active = models.find((m) => m.status === "active");

  return (
    <main className="p-4">
      <header className="mb-4">
        <h1 className="font-sans text-[22px] leading-none font-medium tracking-tight">
          model registry
        </h1>
        <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
          the active model is the artifact every browser downloads · promoting a
          new one takes effect on next page load
        </p>
      </header>

      {error && (
        <p className="mb-3 border border-[var(--critical)] px-3 py-2 text-[11px] text-[var(--critical)]">
          <span aria-hidden>✕ </span>
          {error}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel label="registered artifacts" bodyClassName="p-0" ticked>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[11px] tabular-nums">
              <thead>
                <tr className="border-b border-[var(--hairline)]">
                  <th className="label px-3 py-2 text-left">model</th>
                  <th className="label px-3 py-2 text-right">params</th>
                  <th className="label px-3 py-2 text-right">size</th>
                  <th className="label px-3 py-2 text-right">ppl</th>
                  <th className="label px-3 py-2 text-right">top-5</th>
                  <th className="label px-3 py-2 text-center">status</th>
                  <th className="label px-3 py-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-[var(--hairline)] last:border-0 hover:bg-[var(--surface-2)]"
                  >
                    <td className="px-3 py-2">
                      <span className="block font-mono text-[12px]">
                        {m.name}
                        <span className="text-[var(--ink-muted)]">
                          :{m.version}
                        </span>
                      </span>
                      <span className="block text-[10px] text-[var(--ink-muted)]">
                        {m.quantization} · {relative(m.created_at)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {m.params_total ? compact(m.params_total) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {m.size_bytes ? `${(m.size_bytes / 1e6).toFixed(1)}MB` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {m.perplexity ? Number(m.perplexity).toFixed(1) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--signal)]">
                      {m.top5 ? `${(Number(m.top5) * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {m.status === "active" ? (
                        <Pill tone="live">active</Pill>
                      ) : m.status === "candidate" ? (
                        <Pill tone="warning">candidate</Pill>
                      ) : (
                        <Pill>archived</Pill>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {m.status !== "active" && (
                        <button
                          onClick={() => void activate(m.id)}
                          className="label hover:text-[var(--signal)]"
                        >
                          promote
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!models.length && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-10 text-center text-[var(--ink-muted)]"
                    >
                      no models registered — run{" "}
                      <code className="text-[var(--signal)]">
                        python ml/scripts/publish_run.py
                      </code>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel label="serving now">
          {active ? (
            <>
              <Readout k="model" v={`${active.name}:${active.version}`} tone="signal" />
              <Readout k="quantization" v={active.quantization} />
              <Readout
                k="download"
                v={active.size_bytes ? `${(active.size_bytes / 1e6).toFixed(1)}MB` : "—"}
              />
              <div className="rule my-2" />
              <Readout
                k="params"
                v={active.params_total ? compact(active.params_total) : "—"}
              />
              <Readout
                k="non-embedding"
                v={
                  active.params_non_embedding
                    ? compact(active.params_non_embedding)
                    : "—"
                }
              />
              <Readout k="vocab" v={nf.format(active.vocab_size ?? 0)} />
              <Readout k="context" v={`${active.context_length ?? "—"} tok`} />
              <Readout
                k="train tokens"
                v={compact(Number(active.train_tokens ?? 0))}
              />
              <div className="rule my-2" />
              <Readout
                k="val loss"
                v={active.val_loss ? Number(active.val_loss).toFixed(4) : "—"}
              />
              <Readout
                k="perplexity"
                v={active.perplexity ? Number(active.perplexity).toFixed(2) : "—"}
              />
              <Readout
                k="top-1"
                v={active.top1 ? `${(Number(active.top1) * 100).toFixed(1)}%` : "—"}
              />
              <Readout
                k="top-3"
                v={active.top3 ? `${(Number(active.top3) * 100).toFixed(1)}%` : "—"}
              />
              <Readout
                k="top-5"
                v={active.top5 ? `${(Number(active.top5) * 100).toFixed(1)}%` : "—"}
              />
              {active.notes && (
                <p className="mt-3 border-t border-[var(--hairline)] pt-2 text-[10px] leading-relaxed text-[var(--ink-muted)]">
                  {active.notes}
                </p>
              )}
            </>
          ) : (
            <p className="py-8 text-center text-[11px] text-[var(--ink-muted)]">
              no active model
            </p>
          )}
        </Panel>
      </div>
    </main>
  );
}
