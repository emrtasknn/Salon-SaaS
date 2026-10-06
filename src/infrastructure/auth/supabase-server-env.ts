import "server-only";

import type { SupabaseServerClientConfig } from "./supabase-server-client";

export function readSupabaseServerClientConfig(): SupabaseServerClientConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase server environment is not configured");
  }

  return { url, anonKey };
}
