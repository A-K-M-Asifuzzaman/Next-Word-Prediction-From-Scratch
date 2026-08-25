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
  // The OAuth callback reports failures by redirecting back here with ?error=,
  // so seed local error state from the URL.
  const [error, setError] = useState<string | null>(params.get("error"));
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * OAuth is a full-page redirect, not a fetch: Supabase sends the browser to
   * Google, Google sends it back to /auth/callback with a code, and that route
   * exchanges the code for a session cookie. `next` is carried through the
   * round trip so the user lands where they were originally headed.
   */
  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // On success the browser is already navigating away, so this only runs on
    // a configuration failure (provider disabled, redirect URL not allowlisted).
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

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
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2.5 border border-[var(--hairline-2)] bg-[var(--surface-2)] py-2 text-[11px] tracking-[0.12em] uppercase transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)] disabled:opacity-50"
      >
        <GoogleMark />
        continue with google
      </button>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-[var(--hairline)]" />
        <span className="label">or</span>
        <span className="h-px flex-1 bg-[var(--hairline)]" />
      </div>

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

/** Google's mark in its own colours — the one place brand colour is allowed
 *  to override the instrument palette, because an OAuth button is a promise
 *  about where the click goes. */
function GoogleMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
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
