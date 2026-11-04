"use server";

import { createClosureManagement } from "../../application/closure-management";
import { enforceServerAuthorization } from "../../application/server-authorization-enforcement";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createPrismaClosureDateRepository } from "../../persistence/prisma-closure-dates";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { createAuthenticatedIdentity } from "../../domain/auth-identity";
import type {
  ClosureImpactResult, ClosureListResult, CreateClosureInput, CreateClosureResult, DeleteClosureResult, LocalDateIso,
} from "../appointment-create-contract";

// WP-08: tenant-wide closed dates, TENANT_ADMIN only (same context pattern as calendar-actions).
// Tenant id always comes from the authenticated server context, never from the client.

async function getAdminContext() {
  const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
  const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
  if (request.state !== "authenticated") return null;
  const prisma = getPrisma();
  const reader = createPrismaMembershipReader({ prisma });
  const membership = await reader.readMembership({ tenantContext: request.tenantContext, identity: request.identity });
  if (membership.status !== "found" || !["TENANT_ADMIN", "SUPER_ADMIN"].includes(membership.membership.role)) return null;
  const closures = createClosureManagement({
    repository: createPrismaClosureDateRepository(prisma),
    authorizer: {
      async authorizeAdmin(identity, tenantContext) {
        const result = await enforceServerAuthorization({ identity, tenantContext, requiredRole: "TENANT_ADMIN" }, reader);
        return result.authorization.status === "allowed";
      },
    },
  });
  return {
    closures,
    tenantContext: request.tenantContext,
    identity: createAuthenticatedIdentity(request.identity.subjectId, membership.membership.profileId),
  };
}

export async function listClosures(input: { from: LocalDateIso; to: LocalDateIso }): Promise<ClosureListResult> {
  const context = await getAdminContext();
  if (!context) return { status: "FORBIDDEN" };
  if (typeof input !== "object" || input === null) return { status: "INVALID_INPUT" };
  return context.closures.list(context.identity, context.tenantContext, { from: input.from, to: input.to });
}

export async function previewClosureImpact(date: LocalDateIso): Promise<ClosureImpactResult> {
  const context = await getAdminContext();
  if (!context) return { status: "FORBIDDEN" };
  return context.closures.previewImpact(context.identity, context.tenantContext, date);
}

/** Decision (d): PENDING/CONFIRMED appointments on the date -> HAS_APPOINTMENTS unless confirmed; never auto-cancels. */
export async function createClosure(input: CreateClosureInput): Promise<CreateClosureResult> {
  const context = await getAdminContext();
  if (!context) return { status: "FORBIDDEN" };
  if (typeof input !== "object" || input === null) return { status: "INVALID_INPUT" };
  return context.closures.create(context.identity, context.tenantContext, {
    date: input.date, reason: input.reason, confirmExistingAppointments: input.confirmExistingAppointments,
  });
}

export async function deleteClosure(closureId: string): Promise<DeleteClosureResult> {
  const context = await getAdminContext();
  if (!context) return { status: "FORBIDDEN" };
  return context.closures.delete(context.identity, context.tenantContext, closureId);
}
