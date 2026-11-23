import "server-only";

import { readAuthenticatedTenantRequest } from "../application/auth-request-boundary";
import { createNextSupabaseServerClient } from "../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../infrastructure/auth/supabase-server-env";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaMembershipReader } from "../persistence/prisma-membership-reader";
import { findStaffByProfileId } from "../persistence/prisma-staff-lookup";

/**
 * The signed-in tenant member from the session: tenant, profile, role and whether they have an
 * active staff row. Null when not signed in or not a member. Never takes client input.
 */
export async function readSessionMember() {
  const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
  const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
  if (request.state !== "authenticated") return null;
  const prisma = getPrisma();
  const membership = await createPrismaMembershipReader({ prisma }).readMembership({ tenantContext: request.tenantContext, identity: request.identity });
  if (membership.status !== "found") return null;
  const { role, profileId } = membership.membership;
  const staff = role === "STAFF" || role === "TENANT_ADMIN" ? await findStaffByProfileId(prisma, request.tenantContext, profileId) : null;
  return {
    prisma,
    tenantContext: request.tenantContext,
    profileId,
    role,
    isAdmin: role === "TENANT_ADMIN" || role === "SUPER_ADMIN",
    activeStaffId: staff && staff.status === "ACTIVE" ? staff.id : null,
  };
}
