import type { Metadata } from "next";

import { createClient, getProfile } from "@/lib/supabase/server";

import { WorkspaceClient } from "./WorkspaceClient";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage() {
  const profile = await getProfile();
  const supabase = await createClient();

  const [{ data: documents }, { data: model }] = await Promise.all([
    supabase
      .from("documents")
      .select("id, title, word_count, updated_at")
      .order("updated_at", { ascending: false })
      .limit(30),
    supabase
      .from("models")
      .select("id, name, version, quantization, perplexity, top1, context_length")
      .eq("status", "active")
      .maybeSingle(),
  ]);

  return (
    <WorkspaceClient
      userId={profile!.id}
      prefs={profile!.prefs}
      documents={documents ?? []}
      activeModelId={model?.id ?? null}
    />
  );
}
