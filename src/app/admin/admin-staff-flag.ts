import "server-only";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createAdminServesAsStaff } from "../../application/staff-management";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { createPrismaAdminSelfStaffRepository } from "../../persistence/prisma-staff-management";
import { createAuthenticatedIdentity } from "../../domain/auth-identity";

// Owner decision 2026-11-05: a TENANT_ADMIN may also serve customers as staff.
// Not a "use server" module: nothing here is callable from the client.

/** Server wiring for the admin-serves-as-staff use case (membership read under the trusted tenant). */
export function adminServesAsStaff(prisma: ReturnType<typeof getPrisma>) {
  const reader = createPrismaMembershipReader({ prisma });
  return createAdminServesAsStaff({
    membershipReader: {
      async readOwnMembership(identity, tenantContext) {
        const membership = await reader.readMembership({ tenantContext, identity });
        return membership.status === "found" ? membership.membership : null;
      },
    },
    repository: createPrismaAdminSelfStaffRepository(prisma),
  });
}

/**
 * Navigation hint for later use (e.g. showing a "Randevularım" link to /staff for an admin who
 * serves customers). Reads only the session's own tenant and profile; never authoritative —
 * /staff authorizes itself on every request. Any failure means "no".
 */
export async function readAdminStaffFlag(): Promise<boolean> {
  try {
    const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
    const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
    if (request.state !== "authenticated") return false;
    const prisma = getPrisma();
    const membership = await createPrismaMembershipReader({ prisma }).readMembership({
      tenantContext: request.tenantContext,
      identity: request.identity,
    });
    if (membership.status !== "found") return false;
    const identity = createAuthenticatedIdentity(request.identity.subjectId, membership.membership.profileId);
    const result = await adminServesAsStaff(prisma).read(identity, request.tenantContext);
    return result.status === "ok" && result.servesAsStaff;
  } catch {
    return false;
  }
}
