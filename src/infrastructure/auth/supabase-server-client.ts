import "server-only";

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
