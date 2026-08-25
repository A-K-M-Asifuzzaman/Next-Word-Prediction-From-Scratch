"use client";

import { useState } from "react";

import { Panel, Pill, Readout } from "@/components/instrument/Panel";
import { nf, relative } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/server";

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  request_count: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

/** sha256 hex, via the platform crypto. The raw key is never persisted. */
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const body = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `nwp_live_${body}`;
}

export function SettingsClient({
  profile,
  apiKeys,
}: {
  profile: Profile;
  apiKeys: ApiKey[];
}) {
  const [prefs, setPrefs] = useState(profile.prefs);
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [keys, setKeys] = useState(apiKeys);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");

  async function save() {
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("profiles")
      .update({ prefs, display_name: displayName })
      .eq("id", profile.id);
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }

  async function createKey() {
    const raw = generateKey();
    const supabase = createClient();
    const { data } = await supabase
      .from("api_keys")
      .insert({
        user_id: profile.id,
        name: keyName || "default",
        key_prefix: raw.slice(0, 17),
        key_hash: await sha256(raw),
      })
      .select("id, name, key_prefix, request_count, last_used_at, revoked_at, created_at")
      .single();

    if (data) {
      setKeys((k) => [data as ApiKey, ...k]);
      // Shown exactly once -- we only ever stored the hash.
      setFreshKey(raw);
      setKeyName("");
    }
  }

  async function revoke(id: string) {
    const supabase = createClient();
    await supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    setKeys((k) =>
      k.map((x) =>
        x.id === id ? { ...x, revoked_at: new Date().toISOString() } : x,
      ),
    );
  }

  return (
    <main className="grid-plane min-h-[calc(100dvh-2.75rem)] p-4">
      <h1 className="mb-4 font-sans text-[22px] leading-none font-medium tracking-tight">
        settings
      </h1>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          label="inference"
          ticked
          aside={saved ? <Pill tone="good">saved</Pill> : undefined}
        >
          <label className="mb-4 block">
            <span className="label">display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-[var(--signal)]"
            />
          </label>

          <Slider
            label="temperature"
            value={prefs.temperature}
            min={0.1}
            max={1.5}
            step={0.05}
            onChange={(v) => setPrefs({ ...prefs, temperature: v })}
            hint="Below 1 sharpens the distribution toward the likeliest word; above 1 flattens it. Affects the displayed probabilities, not just sampling."
          />
          <Slider
            label="candidates (top-k)"
            value={prefs.top_k}
            min={3}
            max={10}
            step={1}
            format={(v) => String(v)}
            onChange={(v) => setPrefs({ ...prefs, top_k: v })}
            hint="How many alternatives the distribution panel lists."
          />

          <Toggle
            label="ghost text"
            checked={prefs.ghost_text}
            onChange={(v) => setPrefs({ ...prefs, ghost_text: v })}
            hint="Inline grey completion at the caret, accepted with Tab."
          />
          <Toggle
            label="telemetry"
            checked={prefs.telemetry}
            onChange={(v) => setPrefs({ ...prefs, telemetry: v })}
            hint="Records anonymous prediction metrics — latency, entropy, whether you accepted. Never the text you write. Turning this off empties your dashboard."
          />

          <button
            onClick={save}
            disabled={busy}
            className="mt-4 w-full border border-[var(--signal)] bg-[var(--signal-wash)] py-2 text-[11px] tracking-[0.14em] text-[var(--signal)] uppercase transition-colors hover:bg-[var(--signal)] hover:text-[var(--plane)] disabled:opacity-50"
          >
            {busy ? "…" : "save preferences"}
          </button>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel label="account">
            <Readout k="email" v={profile.email ?? "—"} />
            <Readout
              k="role"
              v={profile.role}
              tone={profile.role === "admin" ? "signal" : "default"}
            />
            <Readout
              k="status"
              v={profile.status}
              tone={profile.status === "active" ? "good" : "critical"}
            />
            <Readout k="joined" v={relative(profile.created_at)} tone="muted" />
          </Panel>

          <Panel label="api keys" bodyClassName="p-3">
            <p className="mb-3 text-[11px] leading-relaxed text-[var(--ink-muted)]">
              Call the prediction endpoint from your own code. Keys are stored
              as a SHA-256 hash — the full value is shown once, here, and never
              again.
            </p>

            <div className="mb-3 flex gap-2">
              <input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="key name"
                className="min-w-0 flex-1 border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-[12px] outline-none focus:border-[var(--signal)]"
              />
              <button
                onClick={createKey}
                className="shrink-0 border border-[var(--hairline)] px-3 text-[11px] tracking-[0.1em] uppercase hover:border-[var(--signal)] hover:text-[var(--signal)]"
              >
                + issue
              </button>
            </div>

            {freshKey && (
              <div className="mb-3 border border-[var(--signal)] bg-[var(--signal-wash)] p-2">
                <p className="label mb-1 text-[var(--signal)]">
                  copy this now — shown once
                </p>
                <code className="block break-all font-mono text-[11px] text-[var(--ink-1)]">
                  {freshKey}
                </code>
              </div>
            )}

            {keys.length ? (
              <ul className="space-y-1">
                {keys.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-center gap-2 border border-[var(--hairline)] px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px]">
                        {k.key_prefix}…
                      </span>
                      <span className="block text-[10px] text-[var(--ink-muted)]">
                        {k.name} · {nf.format(k.request_count)} calls ·{" "}
                        {relative(k.last_used_at)}
                      </span>
                    </span>
                    {k.revoked_at ? (
                      <Pill tone="critical">revoked</Pill>
                    ) : (
                      <button
                        onClick={() => revoke(k.id)}
                        className="label shrink-0 hover:text-[var(--critical)]"
                      >
                        revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-center text-[11px] text-[var(--ink-muted)]">
                no keys issued
              </p>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
  format = (v: number) => v.toFixed(2),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-[12px] tabular-nums text-[var(--signal)]">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[var(--signal)]"
      />
      {hint && (
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--ink-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="label">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative h-4 w-8 shrink-0 border transition-colors ${
            checked
              ? "border-[var(--signal)] bg-[var(--signal-wash)]"
              : "border-[var(--hairline)] bg-[var(--surface-2)]"
          }`}
        >
          <span
            className={`absolute top-[2px] h-[10px] w-[10px] transition-all ${
              checked
                ? "left-[18px] bg-[var(--signal)]"
                : "left-[2px] bg-[var(--ink-muted)]"
            }`}
          />
        </button>
      </label>
      {hint && (
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--ink-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}
