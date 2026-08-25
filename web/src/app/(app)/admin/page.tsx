import type { Metadata } from "next";

import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { Panel, Pill, Readout, StatTile } from "@/components/instrument/Panel";
import { compact, dayLabel, ms, nf } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin · Overview" };

type Overview = {
  total_users: number;
  active_7d: number;
  new_7d: number;
  suspended: number;
  total_predictions: number;
  predictions_24h: number;
  acceptance_rate: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  total_documents: number;
  chars_saved: number;
  active_models: number;
};

export default async function AdminOverview() {
  const supabase = await createClient();

  const [{ data: ov }, { data: daily }, { data: buckets }, { data: tokens }] =
    await Promise.all([
      supabase.rpc("admin_overview"),
      supabase.rpc("admin_daily_series", { days: 30 }),
      supabase.rpc("admin_latency_buckets"),
      supabase.rpc("admin_top_tokens", { n: 12 }),
    ]);

  const o: Overview = ov?.[0] ?? ({} as Overview);
  const series = daily ?? [];
  const labels = series.map((r: { day: string }) => dayLabel(r.day));

  return (
    <main className="p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sans text-[22px] leading-none font-medium tracking-tight">
            control room
          </h1>
          <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
            platform-wide telemetry · all figures live from Postgres
          </p>
        </div>
        <Pill tone="live">{nf.format(o.predictions_24h ?? 0)} preds / 24h</Pill>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="total users"
          value={nf.format(o.total_users ?? 0)}
          hint={`${o.active_7d ?? 0} active this week · ${o.new_7d ?? 0} new`}
        />
        <StatTile
          label="suggestions served"
          value={compact(o.total_predictions ?? 0)}
          hint={`${nf.format(o.predictions_24h ?? 0)} in the last 24h`}
        />
        <StatTile
          label="acceptance rate"
          value={o.acceptance_rate == null ? "—" : o.acceptance_rate.toFixed(1)}
          unit="%"
          hint="platform-wide, all models"
        />
        <StatTile
          label="p95 latency"
          value={ms(o.p95_latency_ms)}
          unit="ms"
          hint={`p50 ${ms(o.p50_latency_ms)}ms · client-side inference`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel label="platform activity · 30 days" ticked>
          <LineChart
            labels={labels}
            showArea
            yFormat="compact"
            series={[
              {
                key: "preds",
                label: "suggestions",
                color: "var(--series-3)",
                values: series.map((r: { predictions: number }) =>
                  Number(r.predictions),
                ),
              },
              {
                key: "accepted",
                label: "accepted",
                color: "var(--series-1)",
                values: series.map((r: { accepted: number }) => Number(r.accepted)),
              },
              {
                key: "users",
                label: "active users",
                color: "var(--series-2)",
                values: series.map((r: { active_users: number }) =>
                  Number(r.active_users),
                ),
              },
            ]}
          />
        </Panel>

        <Panel label="fleet">
          <Readout k="documents" v={nf.format(o.total_documents ?? 0)} />
          <Readout k="chars saved" v={compact(o.chars_saved ?? 0)} tone="signal" />
          <Readout k="active models" v={nf.format(o.active_models ?? 0)} />
          <Readout
            k="suspended accounts"
            v={nf.format(o.suspended ?? 0)}
            tone={o.suspended ? "critical" : "muted"}
          />
          <div className="rule my-2" />
          <p className="text-[10px] leading-relaxed text-[var(--ink-muted)]">
            Inference runs in each visitor&apos;s browser, so &quot;latency&quot;
            here is the aggregate of client-measured forward passes rather than
            server response time. There is no inference server to scale.
          </p>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel label="latency distribution">
          <BarChart
            bars={(buckets ?? []).map((b: { bucket: string; n: number }) => ({
              label: b.bucket,
              value: Number(b.n),
            }))}
            color="var(--series-3)"
            format="compact"
            emptyNote="no measurements yet"
          />
        </Panel>

        <Panel label="most-suggested tokens">
          <BarChart
            mainLabel="suggested"
            subLabel="accepted"
            bars={(tokens ?? []).map(
              (t: { token: string; suggested: number; accepted: number }) => ({
                label: t.token.replace(/^ /, "␣") || "␣",
                value: Number(t.suggested),
                sub: Number(t.accepted),
              }),
            )}
            format="compact"
            emptyNote="no suggestions logged yet"
          />
        </Panel>
      </div>
    </main>
  );
}
