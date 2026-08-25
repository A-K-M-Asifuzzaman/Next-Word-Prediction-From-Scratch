import { redirect } from "next/navigation";

import { Nav } from "@/components/instrument/Nav";
import { getProfile } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  if (profile.status === "suspended") {
    return (
      <main className="grid-plane flex min-h-dvh items-center justify-center p-6">
        <div className="ticked max-w-md border border-[var(--hairline)] bg-[var(--surface-1)] p-6">
          <p className="label text-[var(--critical)]">account suspended</p>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
            This account has been suspended by an administrator. Your documents
            are retained and will be available if the suspension is lifted.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <Nav email={profile.email} role={profile.role} />
      {children}
    </div>
  );
}
