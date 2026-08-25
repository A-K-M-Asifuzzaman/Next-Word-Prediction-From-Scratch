import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";

import { FlagsClient } from "./FlagsClient";

export const metadata: Metadata = { title: "Admin · Flags" };

export default async function FlagsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("feature_flags")
    .select("*")
    .order("key");

  return <FlagsClient initial={data ?? []} />;
}
