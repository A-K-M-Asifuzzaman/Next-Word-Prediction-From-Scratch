import { redirect } from "next/navigation";

import { getProfile } from "@/lib/supabase/server";

import { AdminNav } from "./AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // proxy.ts already gates this path, but a layout check means a routing change
  // can never silently expose the panel. RLS is the boundary that actually
  // matters -- these two are defence in depth.
  const profile = await getProfile();
  if (!profile || profile.role !== "admin" || profile.status !== "active") {
    redirect("/dashboard");
  }

  return (
    <div className="grid-plane min-h-[calc(100dvh-2.75rem)]">
      <AdminNav />
      {children}
    </div>
  );
}
