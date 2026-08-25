"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/workspace";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName || email.split("@")[0] } },
        });
        if (error) throw error;
        // With email confirmation enabled there is no session yet, so tell the
        // user to go check their inbox instead of silently doing nothing.
        if (!data.session) {
          setNotice(
            "Account created. Check your email for the confirmation link, then sign in.",
          );
          setBusy(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "signup" && (
        <Field
          label="display name"
          value={displayName}
          onChange={setDisplayName}
          type="text"
          placeholder="optional"
          autoComplete="nickname"
        />
      )}
      <Field
        label="email"
        value={email}
        onChange={setEmail}
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
      />
      <Field
        label="password"
        value={password}
        onChange={setPassword}
        type="password"
        required
        minLength={8}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        placeholder={mode === "signup" ? "8+ characters" : "••••••••"}
      />

      {error && (
        <p className="border border-[var(--critical)] px-2 py-1.5 text-[11px] text-[var(--critical)]">
          <span aria-hidden>✕ </span>
          {error}
        </p>
      )}
      {notice && (
        <p className="border border-[var(--good)] px-2 py-1.5 text-[11px] text-[var(--good)]">
          <span aria-hidden>✓ </span>
          {notice}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="ticked w-full border border-[var(--signal)] bg-[var(--signal-wash)] py-2 text-[11px] tracking-[0.14em] text-[var(--signal)] uppercase transition-colors hover:bg-[var(--signal)] hover:text-[var(--plane)] disabled:opacity-50"
      >
        {busy ? "…" : mode === "signup" ? "create account" : "sign in"}
      </button>

      <p className="text-center text-[11px] text-[var(--ink-muted)]">
        {mode === "signup" ? (
          <>
            already have one?{" "}
            <Link href="/login" className="text-[var(--signal)] hover:underline">
              sign in
            </Link>
          </>
        ) : (
          <>
            no account?{" "}
            <Link href="/signup" className="text-[var(--signal)] hover:underline">
              create one
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  // Omit the DOM handlers we're replacing, or they collide with ours.
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 py-2 font-mono text-[13px] outline-none focus:border-[var(--signal)]"
      />
    </label>
  );
}
