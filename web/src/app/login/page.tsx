import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return <AuthShell mode="login" />;
}

export function AuthShell({ mode }: { mode: "login" | "signup" }) {
  return (
    <main className="grid-plane flex min-h-dvh flex-col items-center justify-center p-6">
      <Link href="/" className="mb-8 text-[15px] font-semibold tracking-tight">
        NWP<span className="text-[var(--signal)]">//</span>CORE
      </Link>

      <div className="ticked w-full max-w-sm border border-[var(--hairline)] bg-[var(--surface-1)] p-6">
        <h1 className="label mb-1">
          {mode === "login" ? "authenticate" : "provision account"}
        </h1>
        <p className="mb-5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
          {mode === "login"
            ? "Your documents and prediction telemetry are scoped to your account by row-level security."
            : "The model runs in your browser — the text you write is never uploaded, only anonymous prediction metrics."}
        </p>
        <Suspense fallback={<p className="label">loading…</p>}>
          <AuthForm mode={mode} />
        </Suspense>
      </div>

      <p className="mt-6 max-w-sm text-center text-[10px] leading-relaxed text-[var(--ink-muted)]">
        NWP-Core is a 19.5M-parameter transformer trained from scratch. Inference
        happens locally via WebAssembly.
      </p>
    </main>
  );
}
