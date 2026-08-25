"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"instrument" | "paper">("instrument");

  useEffect(() => {
    const stored = localStorage.getItem("nwp-theme");
    if (stored === "paper") setTheme("paper");
  }, []);

  function toggle() {
    const next = theme === "instrument" ? "paper" : "instrument";
    setTheme(next);
    try {
      localStorage.setItem("nwp-theme", next);
    } catch {
      /* private mode: the toggle still works for this session */
    }
    if (next === "paper") {
      document.documentElement.setAttribute("data-theme", "paper");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="label transition-colors hover:text-[var(--signal)]"
      title={`Switch to ${theme === "instrument" ? "paper" : "instrument"} mode`}
    >
      {theme === "instrument" ? "◐ paper" : "◑ instr"}
    </button>
  );
}

export function Nav({
  email,
  role,
}: {
  email: string | null;
  role: "user" | "admin";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const links = [
    { href: "/workspace", label: "workspace" },
    { href: "/dashboard", label: "dashboard" },
    { href: "/settings", label: "settings" },
    ...(role === "admin" ? [{ href: "/admin", label: "admin" }] : []),
  ];

  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[var(--plane)]/95 backdrop-blur-sm">
      <div className="flex h-11 items-center gap-5 px-4">
        <Link href="/" className="group flex items-center gap-2">
          <span className="text-[13px] font-semibold tracking-tight">
            NWP<span className="text-[var(--signal)]">//</span>CORE
          </span>
        </Link>

        <nav className="flex items-center gap-4">
          {links.map((l) => {
            const active =
              pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative py-3 text-[11px] tracking-[0.1em] uppercase transition-colors ${
                  active
                    ? "text-[var(--signal)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink-1)]"
                }`}
              >
                {l.label}
                {active && (
                  <span className="absolute inset-x-0 -bottom-px h-px bg-[var(--signal)]" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <ThemeToggle />
          <span
            className="hidden max-w-[170px] truncate text-[11px] text-[var(--ink-muted)] sm:block"
            title={email ?? ""}
          >
            {email}
          </span>
          {role === "admin" && (
            <span className="border border-[var(--hairline)] px-1.5 py-0.5 text-[9px] tracking-[0.12em] text-[var(--signal)] uppercase">
              admin
            </span>
          )}
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className="label transition-colors hover:text-[var(--critical)] disabled:opacity-50"
          >
            {busy ? "…" : "exit"}
          </button>
        </div>
      </div>
    </header>
  );
}
