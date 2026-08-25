import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side client bound to the request's cookie jar. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to swallow.
          }
        },
      },
    },
  );
}

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_seed: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  prefs: {
    temperature: number;
    top_k: number;
    ghost_text: boolean;
    telemetry: boolean;
    theme: string;
  };
  created_at: string;
  last_seen_at: string | null;
};

/** The signed-in user's profile, or null. Used by every protected layout. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (data as Profile) ?? null;
}
