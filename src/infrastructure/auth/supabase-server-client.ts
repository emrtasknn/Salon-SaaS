import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export type SupabaseServerClientConfig = Readonly<{
  url: string;
  anonKey: string;
}>;

export type SupabaseServerClient = Readonly<{
  auth: Readonly<{
    getUser(): Promise<unknown>;
  }>;
}>;

export type SupabaseServerClientFactory = (
  config: SupabaseServerClientConfig,
) => SupabaseServerClient;

export function createSupabaseServerClient(
  config: SupabaseServerClientConfig,
  factory: SupabaseServerClientFactory,
): SupabaseServerClient {
  if (
    typeof config.url !== "string" ||
    config.url.length === 0 ||
    typeof config.anonKey !== "string" ||
    config.anonKey.length === 0
  ) {
    throw new TypeError("Supabase server client configuration is invalid");
  }

  return factory(config);
}

export async function createNextSupabaseServerClient(
  config: SupabaseServerClientConfig,
) {
  if (
    typeof config.url !== "string" ||
    config.url.length === 0 ||
    typeof config.anonKey !== "string" ||
    config.anonKey.length === 0
  ) {
    throw new TypeError("Supabase server client configuration is invalid");
  }

  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies. Next.js proxy
          // refreshes and persists the session.
        }
      },
    },
  });
}
