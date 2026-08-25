import type { Metadata } from "next";
import Link from "next/link";

import { LineChart } from "@/components/charts/LineChart";
import { Panel, Readout, StatTile } from "@/components/instrument/Panel";
import { compact, dayLabel, ms, nf, pct, relative } from "@/lib/format";
import { createClient, getProfile } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

type Stats = {
  predictions: number;
  accepted: number;
  acceptance_rate: number | null;
  chars_saved: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  active_days: number;
  documents: number;
  words_written: number;
};

type DayRow = {
  day: string;
  predictions: number;
  accepted: number;
  chars_saved: number;
  avg_latency_ms: number | null;
};

export default async function DashboardPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  const [{ data: statsRows }, { data: seriesRows }, { data: docs }] =
    await Promise.all([
      supabase.rpc("user_stats", { days: 30 }),
      supabase.rpc("user_daily_series", { days: 30 }),
      supabase
        .from("documents")
        .select("id, title, word_count, updated_at")
        .order("updated_at", { ascending: false })
        .limit(6),
    ]);

  const s: Stats = statsRows?.[0] ?? {
    predictions: 0,
    accepted: 0,
    acceptance_rate: null,
    chars_saved: 0,
    avg_latency_ms: null,
    p95_latency_ms: null,
    active_days: 0,
    documents: 0,
    words_written: 0,
  };
  const series: DayRow[] = seriesRows ?? [];
  const labels = series.map((r) => dayLabel(r.day));

  // A keystroke saved is a real unit: every accepted suggestion is characters
  // the writer did not have to type.
  const keystrokeMinutes = s.chars_saved / 5 / 40; // ~40 wpm, 5 chars/word

  return (
    <main className="grid-plane min-h-[calc(100dvh-2.75rem)] p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sans text-[22px] leading-none font-medium tracking-tight">
            {profile?.display_name ?? "your"} instrument log
          </h1>
          <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
            last 30 days · every figure below is computed from your own
            prediction events under row-level security
          </p>
        </div>
        <Link
          href="/workspace"
          className="border border-[var(--hairline)] px-3 py-1.5 text-[11px] tracking-[0.1em] uppercase transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
        >
          open workspace →
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="suggestions shown"
          value={compact(s.predictions)}
          hint={`${nf.format(s.accepted)} accepted`}
        />
        <StatTile
          label="acceptance rate"
          value={s.acceptance_rate == null ? "—" : s.acceptance_rate.toFixed(1)}
          unit="%"
          hint="share of surfaced suggestions you took"
        />
        <StatTile
          label="characters saved"
          value={compact(s.chars_saved)}
          hint={`≈ ${keystrokeMinutes.toFixed(1)} min of typing at 40wpm`}
        />
        <StatTile
          label="median latency"
          value={ms(s.avg_latency_ms)}
          unit="ms"
          hint={`p95 ${ms(s.p95_latency_ms)}ms · in-browser, no server hop`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel label="activity · suggestions vs accepted" ticked>
          <LineChart
            labels={labels}
            showArea
            series={[
              {
                key: "shown",
                label: "shown",
                color: "var(--series-3)",
                values: series.map((r) => Number(r.predictions)),
              },
              {
                key: "accepted",
                label: "accepted",
                color: "var(--series-1)",
                values: series.map((r) => Number(r.accepted)),
              },
            ]}
          />
        </Panel>

        <Panel label="totals">
          <Readout k="documents" v={nf.format(s.documents)} />
          <Readout k="words written" v={nf.format(s.words_written)} />
          <Readout k="active days" v={`${s.active_days}/30`} />
          <div className="rule my-2" />
          <Readout
            k="accepted"
            v={nf.format(s.accepted)}
            tone="signal"
          />
          <Readout k="declined" v={nf.format(s.predictions - s.accepted)} />
          <Readout k="chars saved" v={nf.format(s.chars_saved)} />
          <div className="rule my-2" />
          <Readout k="avg latency" v={`${ms(s.avg_latency_ms)}ms`} tone="muted" />
          <Readout k="p95 latency" v={`${ms(s.p95_latency_ms)}ms`} tone="muted" />
          <p className="mt-3 text-[10px] leading-relaxed text-[var(--ink-muted)]">
            Latency is measured inside your browser: tokenise → forward pass →
            softmax → top-k. There is no network in that path.
          </p>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel label="characters saved per day">
          <LineChart
            labels={labels}
            yFormat="compact"
            series={[
              {
                key: "saved",
                label: "chars saved",
                color: "var(--series-2)",
                values: series.map((r) => Number(r.chars_saved)),
              },
            ]}
            showArea
          />
        </Panel>

        <Panel label="recent documents" bodyClassName="p-0">
          {docs?.length ? (
            <ul>
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] px-3 py-2 last:border-b-0"
                >
                  <span className="truncate font-sans text-[13px]">{d.title}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-[var(--ink-muted)]">
                    {nf.format(d.word_count)}w · {relative(d.updated_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-8 text-center text-[11px] text-[var(--ink-muted)]">
              nothing written yet —{" "}
              <Link href="/workspace" className="text-[var(--signal)]">
                open the workspace
              </Link>
            </p>
          )}
        </Panel>
      </div>

      {s.predictions === 0 && (
        <p className="mt-3 border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-[11px] text-[var(--ink-muted)]">
          <span aria-hidden className="text-[var(--warning)]">▲ </span>
          No prediction events recorded yet. Charts fill in once you write in the
          workspace with telemetry enabled ({pct(0, 0)} so far).
        </p>
      )}
    </main>
  );
}
