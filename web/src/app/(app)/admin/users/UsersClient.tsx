"use client";

import { useState, useTransition } from "react";

import { Panel, Pill } from "@/components/instrument/Panel";
import { nf, relative } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type Row = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  created_at: string;
  last_seen_at: string | null;
  predictions: number;
  accepted: number;
  documents: number;
};

export function UsersClient({
  initial,
  selfId,
}: {
  initial: Row[];
  selfId: string;
}) {
  const [rows, setRows] = useState(initial);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function refresh(term: string) {
    const supabase = createClient();
    const { data } = await supabase.rpc("admin_user_list", {
      search: term,
      lim: 100,
      off: 0,
    });
    setRows(data ?? []);
  }

  async function mutate(
    id: string,
    patch: { new_role?: "user" | "admin"; new_status?: "active" | "suspended" },
  ) {
    setError(null);
    const supabase = createClient();
    // Goes through a SECURITY DEFINER function that re-checks admin rights and
    // writes an audit_log row, so a role change is never an untraced UPDATE.
    const { error } = await supabase.rpc("admin_set_user", {
      target: id,
      new_role: patch.new_role ?? null,
      new_status: patch.new_status ?? null,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setRows((r) =>
      r.map((x) =>
        x.id === id
          ? {
              ...x,
              role: patch.new_role ?? x.role,
              status: patch.new_status ?? x.status,
            }
          : x,
      ),
    );
  }

  return (
    <main className="p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sans text-[22px] leading-none font-medium tracking-tight">
            users
          </h1>
          <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
            {nf.format(rows.length)} accounts · role and status changes are
            written to the audit log
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            startTransition(() => void refresh(e.target.value));
          }}
          placeholder="search email or name"
          className="w-56 border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-[var(--signal)]"
        />
      </header>

      {error && (
        <p className="mb-3 border border-[var(--critical)] px-3 py-2 text-[11px] text-[var(--critical)]">
          <span aria-hidden>✕ </span>
          {error}
        </p>
      )}

      <Panel label={pending ? "loading…" : "accounts"} bodyClassName="p-0" ticked>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[11px] tabular-nums">
            <thead>
              <tr className="border-b border-[var(--hairline)]">
                <th className="label px-3 py-2 text-left">account</th>
                <th className="label px-3 py-2 text-right">preds</th>
                <th className="label px-3 py-2 text-right">accepted</th>
                <th className="label px-3 py-2 text-right">docs</th>
                <th className="label px-3 py-2 text-right">joined</th>
                <th className="label px-3 py-2 text-center">role</th>
                <th className="label px-3 py-2 text-right">actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-[var(--hairline)] last:border-0 hover:bg-[var(--surface-2)]"
                >
                  <td className="px-3 py-2">
                    <span className="block font-mono text-[12px] text-[var(--ink-1)]">
                      {u.email}
                    </span>
                    <span className="block text-[10px] text-[var(--ink-muted)]">
                      {u.display_name}
                      {u.id === selfId && " · you"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{nf.format(u.predictions)}</td>
                  <td className="px-3 py-2 text-right text-[var(--signal)]">
                    {nf.format(u.accepted)}
                  </td>
                  <td className="px-3 py-2 text-right">{nf.format(u.documents)}</td>
                  <td className="px-3 py-2 text-right text-[var(--ink-muted)]">
                    {relative(u.created_at)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.role === "admin" ? (
                      <Pill tone="live">admin</Pill>
                    ) : u.status === "suspended" ? (
                      <Pill tone="critical">suspended</Pill>
                    ) : (
                      <Pill>user</Pill>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {u.id !== selfId && (
                      <>
                        <button
                          onClick={() =>
                            void mutate(u.id, {
                              new_role: u.role === "admin" ? "user" : "admin",
                            })
                          }
                          className="label mr-3 hover:text-[var(--signal)]"
                        >
                          {u.role === "admin" ? "demote" : "promote"}
                        </button>
                        <button
                          onClick={() =>
                            void mutate(u.id, {
                              new_status:
                                u.status === "active" ? "suspended" : "active",
                            })
                          }
                          className="label hover:text-[var(--critical)]"
                        >
                          {u.status === "active" ? "suspend" : "restore"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-10 text-center text-[var(--ink-muted)]"
                  >
                    no accounts match
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}
