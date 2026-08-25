"use client";

import { useState } from "react";

import { Panel } from "@/components/instrument/Panel";
import { relative } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type Flag = {
  key: string;
  enabled: boolean;
  rollout_pct: number;
  description: string | null;
  updated_at: string;
};

export function FlagsClient({ initial }: { initial: Flag[] }) {
  const [flags, setFlags] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function update(key: string, patch: Partial<Flag>) {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("feature_flags")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("key", key);
    if (error) {
      setError(error.message);
      return;
    }
    setFlags((f) => f.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  return (
    <main className="p-4">
      <header className="mb-4">
        <h1 className="font-sans text-[22px] leading-none font-medium tracking-tight">
          feature flags
        </h1>
        <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
          readable by every client, writable only by admins — enforced by RLS,
          not by hiding the UI
        </p>
      </header>

      {error && (
        <p className="mb-3 border border-[var(--critical)] px-3 py-2 text-[11px] text-[var(--critical)]">
          <span aria-hidden>✕ </span>
          {error}
        </p>
      )}

      <Panel label="flags" bodyClassName="p-0" ticked>
        <ul>
          {flags.map((f) => (
            <li
              key={f.key}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--hairline)] px-3 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <span className="block font-mono text-[12px] text-[var(--ink-1)]">
                  {f.key}
                </span>
                <span className="block text-[10px] text-[var(--ink-muted)]">
                  {f.description} · updated {relative(f.updated_at)}
                </span>
              </div>

              <label className="flex items-center gap-2">
                <span className="label">rollout</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={f.rollout_pct}
                  onChange={(e) =>
                    void update(f.key, { rollout_pct: Number(e.target.value) })
                  }
                  className="w-24 accent-[var(--signal)]"
                />
                <span className="w-8 text-right font-mono text-[11px] tabular-nums">
                  {f.rollout_pct}%
                </span>
              </label>

              <button
                type="button"
                role="switch"
                aria-checked={f.enabled}
                onClick={() => void update(f.key, { enabled: !f.enabled })}
                className={`relative h-4 w-8 shrink-0 border transition-colors ${
                  f.enabled
                    ? "border-[var(--signal)] bg-[var(--signal-wash)]"
                    : "border-[var(--hairline)] bg-[var(--surface-2)]"
                }`}
              >
                <span
                  className={`absolute top-[2px] h-[10px] w-[10px] transition-all ${
                    f.enabled
                      ? "left-[18px] bg-[var(--signal)]"
                      : "left-[2px] bg-[var(--ink-muted)]"
                  }`}
                />
              </button>

              <span
                className={`w-14 text-right text-[10px] tracking-[0.12em] uppercase ${
                  f.enabled ? "text-[var(--good)]" : "text-[var(--ink-muted)]"
                }`}
              >
                <span aria-hidden>{f.enabled ? "✓ " : "· "}</span>
                {f.enabled ? "on" : "off"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
