import "server-only";

import { createSupabaseAuthAdapter } from "./supabase-auth-adapter";
import {
  createNextSupabaseServerClient,
  type SupabaseServerClientConfig,
} from "./supabase-server-client";

export async function createNextServerAuthAdapter(
  config: SupabaseServerClientConfig,
) {
  const client = await createNextSupabaseServerClient(config);
  return createSupabaseAuthAdapter({ client });
}
