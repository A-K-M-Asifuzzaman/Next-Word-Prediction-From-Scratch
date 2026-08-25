import type { Metadata } from "next";

import { createClient, getProfile } from "@/lib/supabase/server";

import { SettingsClient } from "./SettingsClient";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, request_count, last_used_at, revoked_at, created_at")
    .order("created_at", { ascending: false });

  return (
    <SettingsClient
      profile={profile!}
      apiKeys={keys ?? []}
    />
  );
}
