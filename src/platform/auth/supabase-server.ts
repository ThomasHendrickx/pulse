import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "../config";

// Server-side Supabase client bound to the request's cookies. Auth is
// Supabase Auth with email and password only: no OAuth, no magic links, no
// local password handling outside Supabase (charter auth decision).

export const createSupabaseServerClient = async () => {
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: the middleware refreshes sessions.
        }
      },
    },
  });
};
