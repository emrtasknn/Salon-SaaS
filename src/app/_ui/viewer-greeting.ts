import "server-only";

import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import {
  withPrismaTenantContext,
  type PrismaTenantClient,
  type PrismaTenantTransactionClient,
} from "../../persistence/prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  profile: {
    findUnique(args: {
      where: { tenantId_id: { tenantId: string; id: string } };
      select: { displayName: true };
    }): Promise<{ displayName: string } | null>;
  };
  tenant: {
    findUnique(args: { where: { id: string }; select: { name: true } }): Promise<{ name: string } | null>;
  };
};

export type ViewerGreeting = Readonly<{ displayName: string | null; tenantName: string | null }>;

const EMPTY: ViewerGreeting = { displayName: null, tenantName: null };

/**
 * Display-only: the signed-in user's own profile name and salon name for the
 * greeting header. Tenant and profile come from the session + membership; never
 * used for authorization. Any failure degrades to an anonymous greeting.
 */
export async function readViewerGreeting(): Promise<ViewerGreeting> {
  try {
    const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
    const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
    if (request.state !== "authenticated") return EMPTY;
    const prisma = getPrisma();
    const membership = await createPrismaMembershipReader({ prisma }).readMembership({
      tenantContext: request.tenantContext,
      identity: request.identity,
    });
    if (membership.status !== "found") return EMPTY;
    const tenantId = request.tenantContext.tenantId;
    const profileId = membership.membership.profileId;
    return await withPrismaTenantContext(
      prisma as unknown as PrismaTenantClient,
      request.tenantContext,
      async (tx: Tx) => {
        const [profile, tenant] = await Promise.all([
          tx.profile.findUnique({ where: { tenantId_id: { tenantId, id: profileId } }, select: { displayName: true } }),
          tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        ]);
        return { displayName: profile?.displayName?.trim() || null, tenantName: tenant?.name?.trim() || null };
      },
    );
  } catch {
    return EMPTY;
  }
}
