"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "overview" },
  { href: "/admin/training", label: "training" },
  { href: "/admin/models", label: "models" },
  { href: "/admin/users", label: "users" },
  { href: "/admin/telemetry", label: "telemetry" },
  { href: "/admin/flags", label: "flags" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--hairline)] bg-[var(--surface-1)] px-4">
      {TABS.map((t) => {
        const active =
          t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`border-b-2 px-3 py-2.5 text-[11px] tracking-[0.1em] whitespace-nowrap uppercase transition-colors ${
              active
                ? "border-[var(--signal)] text-[var(--signal)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink-1)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
