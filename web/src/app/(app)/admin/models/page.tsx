import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";

import { ModelsClient } from "./ModelsClient";

export const metadata: Metadata = { title: "Admin · Models" };

export default async function ModelsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("models")
    .select("*")
    .order("created_at", { ascending: false });

  return <ModelsClient initial={data ?? []} />;
}
