"use client";

import { createBrowserClient } from "@supabase/ssr";

export type SupabaseBrowserClientConfig = Readonly<{
  url: string;
  anonKey: string;
}>;

export function createSupabaseBrowserClient(
  config: SupabaseBrowserClientConfig,
) {
  if (
    typeof config.url !== "string" ||
    config.url.length === 0 ||
    typeof config.anonKey !== "string" ||
    config.anonKey.length === 0
  ) {
    throw new TypeError("Supabase browser client configuration is invalid");
  }

  return createBrowserClient(config.url, config.anonKey);
}

export function createNextSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase browser environment is not configured");
  }

  return createSupabaseBrowserClient({
    url,
    anonKey,
  });
}