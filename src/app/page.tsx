export const dynamic = "force-dynamic";

import {
  readAuthenticatedPlatformRequest,
  readAuthenticatedTenantRequest,
} from "../application/auth-request-boundary";
import { createSupabaseAuthAdapter } from "../infrastructure/auth/supabase-auth-adapter";
import { createNextSupabaseServerClient } from "../infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "../infrastructure/auth/supabase-server-env";
import { EntryRedirect } from "./entry-redirect";
import { SignInScreen } from "./login/sign-in-screen";
import { RecoveryRedirect } from "./recovery-redirect";

/**
 * Navigation only (same rules as the login form): SUPER_ADMIN → /platform/tenants,
 * any other signed-in tenant user → /admin (which forwards STAFF to /staff).
 * Destination pages re-check authorization; this never grants access.
 * Any failure falls back to the sign-in screen.
 */
async function readEntryTarget(): Promise<string | null> {
  try {
    const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
    const source = createSupabaseAuthAdapter({ client: supabase as never });
    // One auth lookup shared by both checks.
    let snapshot: ReturnType<typeof source.readIdentity> | undefined;
    const adapter = { readIdentity: () => (snapshot ??= source.readIdentity()) };
    const platform = await readAuthenticatedPlatformRequest(adapter);
    if (platform.state === "authenticated") return "/platform/tenants";
    const tenant = await readAuthenticatedTenantRequest(adapter);
    if (tenant.state === "authenticated") return "/admin";
    return null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const target = await readEntryTarget();
  return (
    <>
      {/* Must stay mounted: recovery/invite links land on `/` with a #type=… hash. */}
      <RecoveryRedirect />
      {target === null ? <SignInScreen /> : <EntryRedirect target={target} />}
    </>
  );
}
