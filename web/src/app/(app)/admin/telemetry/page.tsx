import type { Metadata } from "next";

import { Panel, Pill, StatTile } from "@/components/instrument/Panel";
import { compact, nf, relative } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin · Telemetry" };

export default async function TelemetryPage() {
  const supabase = await createClient();

  const [{ data: events }, { data: audit }, { count }] = await Promise.all([
    supabase
      .from("prediction_events")
      .select(
        "id, created_at, latency_ms, context_tokens, top1_token, top1_prob, entropy, accepted, accepted_rank, chars_saved, source",
      )
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("audit_log")
      .select("id, action, target_type, target_id, meta, created_at")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("prediction_events")
      .select("*", { count: "exact", head: true }),
  ]);

  const rows = events ?? [];
  const meanEntropy =
    rows.length
      ? rows.reduce((a, r) => a + Number(r.entropy ?? 0), 0) / rows.length
      : 0;

  return (
    <main className="p-4">
      <header className="mb-4">
        <h1 className="font-sans text-[22px] leading-none font-medium tracking-tight">
          telemetry
        </h1>
        <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
          raw prediction events · text content is never recorded, only the
          suggested token and its statistics
        </p>
      </header>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <StatTile label="events stored" value={compact(count ?? 0)} />
        <StatTile
          label="mean entropy"
          value={meanEntropy.toFixed(2)}
          unit="bits"
          hint={`≈ ${Math.round(Math.pow(2, meanEntropy))} effective choices per position`}
        />
        <StatTile
          label="audit entries"
          value={nf.format(audit?.length ?? 0)}
          hint="recent admin mutations"
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel label="event stream · newest first" bodyClassName="p-0" ticked>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[640px] text-[11px] tabular-nums">
              <thead className="sticky top-0 bg-[var(--surface-2)]">
                <tr className="border-b border-[var(--hairline)]">
                  <th className="label px-3 py-2 text-left">when</th>
                  <th className="label px-3 py-2 text-left">token</th>
                  <th className="label px-3 py-2 text-right">p</th>
                  <th className="label px-3 py-2 text-right">H</th>
                  <th className="label px-3 py-2 text-right">ctx</th>
                  <th className="label px-3 py-2 text-right">ms</th>
                  <th className="label px-3 py-2 text-center">taken</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-[var(--hairline)] last:border-0"
                  >
                    <td className="px-3 py-1.5 text-[var(--ink-muted)]">
                      {relative(e.created_at)}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[var(--ink-1)]">
                      {(e.top1_token ?? "").replace(/^ /, "␣") || "␣"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {e.top1_prob ? (Number(e.top1_prob) * 100).toFixed(1) : "—"}%
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {e.entropy ? Number(e.entropy).toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">{e.context_tokens}</td>
                    <td className="px-3 py-1.5 text-right">
                      {Number(e.latency_ms).toFixed(1)}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {e.accepted ? (
                        <span className="text-[var(--good)]">
                          <span aria-hidden>✓</span> #{e.accepted_rank}
                        </span>
                      ) : (
                        <span className="text-[var(--ink-muted)]">·</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-12 text-center text-[var(--ink-muted)]"
                    >
                      no events yet — write something in the workspace
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel label="audit log" bodyClassName="p-0">
          <ul className="max-h-[560px] overflow-auto">
            {(audit ?? []).map((a) => (
              <li
                key={a.id}
                className="border-b border-[var(--hairline)] px-3 py-2 last:border-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <Pill tone={a.action.includes("activate") ? "live" : "neutral"}>
                    {a.action}
                  </Pill>
                  <span className="text-[10px] text-[var(--ink-muted)]">
                    {relative(a.created_at)}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-[var(--ink-muted)]">
                  {a.target_type}:{a.target_id?.slice(0, 8)}
                  {a.meta && Object.keys(a.meta).length > 0
                    ? ` · ${JSON.stringify(a.meta)}`
                    : ""}
                </p>
              </li>
            ))}
            {!audit?.length && (
              <li className="px-3 py-12 text-center text-[11px] text-[var(--ink-muted)]">
                no admin actions recorded
              </li>
            )}
          </ul>
        </Panel>
      </div>
    </main>
  );
}
