import "server-only";

import { createHash } from "node:crypto";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";

/**
 * WP-09: opaque, non-authoritative device-binding key for the push opt-in UI
 * (hash of tenant + auth subject). Never used for authorization; the push
 * actions derive tenant/profile from the session themselves. Null when not signed in.
 */
export async function readPushBindingKey(): Promise<string | null> {
  try {
    const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
    const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
    if (request.state !== "authenticated") return null;
    return createHash("sha256")
      .update(`${request.tenantContext.tenantId}:${request.identity.subjectId}`)
      .digest("hex")
      .slice(0, 32);
  } catch {
    return null;
  }
}
