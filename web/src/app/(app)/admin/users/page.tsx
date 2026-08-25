import type { Metadata } from "next";

import { createClient, getProfile } from "@/lib/supabase/server";

import { UsersClient } from "./UsersClient";

export const metadata: Metadata = { title: "Admin · Users" };

export default async function UsersPage() {
  const supabase = await createClient();
  const me = await getProfile();

  const { data } = await supabase.rpc("admin_user_list", {
    search: "",
    lim: 100,
    off: 0,
  });

  return <UsersClient initial={data ?? []} selfId={me!.id} />;
}
