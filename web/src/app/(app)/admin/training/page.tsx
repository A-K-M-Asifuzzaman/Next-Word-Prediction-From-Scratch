import type { Metadata } from "next";

import { LineChart } from "@/components/charts/LineChart";
import { Panel, Pill, Readout, StatTile } from "@/components/instrument/Panel";
import { compact, nf, relative } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin · Training" };

export default async function TrainingPage() {
  const supabase = await createClient();

  const { data: runs } = await supabase
    .from("training_runs")
    .select("*")
    .order("created_at", { ascending: false });

  const run = runs?.[0];
  if (!run) {
    return (
      <main className="p-4">
        <Panel label="training runs">
          <p className="py-10 text-center text-[11px] text-[var(--ink-muted)]">
            No runs published yet. Push one with{" "}
            <code className="text-[var(--signal)]">
              python ml/scripts/publish_run.py
            </code>
          </p>
        </Panel>
      </main>
    );
  }

  const [{ data: trainRows }, { data: evalRows }] = await Promise.all([
    supabase
      .from("training_metrics")
      .select("step, ema_loss, perplexity, lr, grad_norm, tokens_per_sec, tokens")
      .eq("run_id", run.id)
      .eq("kind", "train")
      .order("step"),
    supabase
      .from("training_metrics")
      .select("step, loss, perplexity, top1, top3, top5, tokens")
      .eq("run_id", run.id)
      .eq("kind", "eval")
      .order("step"),
  ]);

  // The training stream logs every 20 steps; at 16k steps that's 800 points,
  // more than a 720px-wide chart can resolve. Downsample to ~180.
  const train = downsample(trainRows ?? [], 180);
  const evals = evalRows ?? [];

  const best = evals.reduce(
    (b, e) => (b === null || Number(e.loss) < Number(b.loss) ? e : b),
    null as (typeof evals)[number] | null,
  );
  const cfg = (run.config ?? {}) as Record<string, unknown>;
  const corpus = (run.corpus ?? {}) as Record<string, number>;

  return (
    <main className="p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sans text-[22px] leading-none font-medium tracking-tight">
            {run.run_name}
          </h1>
          <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
            trained from scratch on {compact(corpus.train ?? 0)} tokens ·{" "}
            {run.device} · started {relative(run.started_at)}
          </p>
        </div>
        <Pill tone={run.status === "complete" ? "good" : "live"}>{run.status}</Pill>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="best val perplexity"
          value={best ? Number(best.perplexity).toFixed(1) : "—"}
          hint={best ? `at step ${nf.format(best.step)}` : undefined}
        />
        <StatTile
          label="top-1 accuracy"
          value={best?.top1 != null ? (Number(best.top1) * 100).toFixed(1) : "—"}
          unit="%"
          hint="exact next token, held-out text"
        />
        <StatTile
          label="top-5 accuracy"
          value={best?.top5 != null ? (Number(best.top5) * 100).toFixed(1) : "—"}
          unit="%"
          hint="true token inside the 5 suggestions shown"
        />
        <StatTile
          label="tokens seen"
          value={compact(Number(run.tokens_seen ?? 0))}
          hint={`${nf.format(run.total_steps ?? 0)} optimizer steps`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel label="loss curve · train ema vs held-out" ticked>
          <LineChart
            height={230}
            labels={train.map((r) => nf.format(r.step))}
            yFormat="fixed2"
            series={[
              {
                key: "train",
                label: "train (ema)",
                color: "var(--series-3)",
                values: train.map((r) => Number(r.ema_loss ?? 0)),
              },
              {
                key: "val",
                label: "held-out",
                color: "var(--series-2)",
                values: alignToSteps(
                  evals.map((e) => ({ step: e.step, v: Number(e.loss) })),
                  train.map((r) => r.step),
                ),
              },
            ]}
          />
          <p className="mt-2 text-[10px] leading-relaxed text-[var(--ink-muted)]">
            Held-out loss tracking train loss without separating means the model
            is still underfitting the corpus — expected at under 1.3 epochs over
            270M tokens, and the reason no dropout is used.
          </p>
        </Panel>

        <Panel label="configuration">
          <Readout k="architecture" v="decoder-only" tone="muted" />
          <Readout k="layers" v={String(cfg.n_layer ?? "—")} />
          <Readout k="d_model" v={String(cfg.n_embd ?? "—")} />
          <Readout k="heads" v={`${cfg.n_head ?? "—"} q / ${cfg.n_kv_head ?? "—"} kv`} />
          <Readout k="context" v={`${cfg.block_size ?? "—"} tok`} />
          <div className="rule my-2" />
          <Readout k="peak lr" v={String(cfg.lr ?? "—")} />
          <Readout k="batch" v={`${cfg.batch_size ?? "—"} × ${cfg.grad_accum ?? "—"}`} />
          <Readout k="weight decay" v={String(cfg.weight_decay ?? "—")} />
          <Readout k="precision" v="bf16 autocast" tone="muted" />
          <div className="rule my-2" />
          <Readout k="norm" v="RMSNorm" tone="muted" />
          <Readout k="position" v="RoPE" tone="muted" />
          <Readout k="ffn" v="SwiGLU" tone="muted" />
          <Readout k="attention" v="grouped-query" tone="muted" />
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel label="held-out accuracy">
          <LineChart
            labels={evals.map((e) => nf.format(e.step))}
            yFormat="pctInt"
            series={[
              {
                key: "top1",
                label: "top-1",
                color: "var(--series-1)",
                values: evals.map((e) => Number(e.top1 ?? 0)),
              },
              {
                key: "top3",
                label: "top-3",
                color: "var(--series-3)",
                values: evals.map((e) => Number(e.top3 ?? 0)),
              },
              {
                key: "top5",
                label: "top-5",
                color: "var(--series-5)",
                values: evals.map((e) => Number(e.top5 ?? 0)),
              },
            ]}
          />
        </Panel>

        <Panel label="learning rate schedule">
          <LineChart
            labels={train.map((r) => nf.format(r.step))}
            yFormat="exp"
            series={[
              {
                key: "lr",
                label: "lr",
                color: "var(--series-5)",
                values: train.map((r) => Number(r.lr ?? 0)),
              },
            ]}
          />
          <p className="mt-2 text-[10px] text-[var(--ink-muted)]">
            500-step linear warmup, then cosine decay to 10% of peak.
          </p>
        </Panel>

        <Panel label="gradient norm">
          <LineChart
            labels={train.map((r) => nf.format(r.step))}
            yFormat="fixed2"
            series={[
              {
                key: "gn",
                label: "grad norm",
                color: "var(--series-6)",
                values: train.map((r) => Number(r.grad_norm ?? 0)),
              },
            ]}
          />
          <p className="mt-2 text-[10px] text-[var(--ink-muted)]">
            Clipped at 1.0. A flat trace means training is stable; spikes would
            mean the learning rate is too high for the batch size.
          </p>
        </Panel>
      </div>

      {runs.length > 1 && (
        <Panel label="all runs" className="mt-3" bodyClassName="p-0">
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="border-b border-[var(--hairline)]">
                <th className="label px-3 py-2 text-left">run</th>
                <th className="label px-3 py-2 text-right">steps</th>
                <th className="label px-3 py-2 text-right">tokens</th>
                <th className="label px-3 py-2 text-right">best ppl</th>
                <th className="label px-3 py-2 text-right">status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-[var(--hairline)] last:border-0">
                  <td className="px-3 py-2 font-mono">{r.run_name}</td>
                  <td className="px-3 py-2 text-right">{nf.format(r.total_steps ?? 0)}</td>
                  <td className="px-3 py-2 text-right">{compact(Number(r.tokens_seen ?? 0))}</td>
                  <td className="px-3 py-2 text-right">
                    {r.best_perplexity ? Number(r.best_perplexity).toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--ink-muted)]">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </main>
  );
}

function downsample<T>(rows: T[], target: number): T[] {
  if (rows.length <= target) return rows;
  const stride = Math.ceil(rows.length / target);
  const out = rows.filter((_, i) => i % stride === 0);
  // Always keep the final point so the curve ends where training ended.
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
}

/**
 * Evals happen every 500 steps but the train series is denser, so eval points
 * are carried forward onto the train grid. Both series therefore share one
 * x-axis -- far better than the alternative of a second axis.
 */
function alignToSteps(
  points: { step: number; v: number }[],
  grid: number[],
): number[] {
  if (!points.length) return grid.map(() => 0);
  let i = 0;
  let last = points[0].v;
  return grid.map((s) => {
    while (i < points.length && points[i].step <= s) {
      last = points[i].v;
      i++;
    }
    return last;
  });
}
