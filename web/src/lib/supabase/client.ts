"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client. Safe to call repeatedly - @supabase/ssr
 *  memoises the underlying client per set of arguments. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
