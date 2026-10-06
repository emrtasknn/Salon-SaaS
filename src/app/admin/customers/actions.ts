"use server";

import { createCalendarCrm } from "../../../application/calendar-crm";
import { enforceServerAuthorization } from "../../../application/server-authorization-enforcement";
import { createAuthenticatedIdentity } from "../../../domain/auth-identity";
import { createPrismaCalendarCrmRepository } from "../../../persistence/prisma-calendar-crm";
import { createPrismaMembershipReader } from "../../../persistence/prisma-membership-reader";
import { createNextSupabaseServerClient } from "../../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../../infrastructure/auth/supabase-server-env";
import { readAuthenticatedTenantRequest } from "../../../application/auth-request-boundary";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
import type { TenantContext } from "../../../domain/tenant-context";

async function context() {
  const supabase = await createNextSupabaseServerClient(
    readSupabaseServerClientConfig(),
  );
  const req = await readAuthenticatedTenantRequest(
    createSupabaseAuthAdapter({ client: supabase as never }),
  );
  if (req.state !== "authenticated") return null;

  const prisma = getPrisma();
  const reader = createPrismaMembershipReader({ prisma });
  const membership = await reader.readMembership({
    tenantContext: req.tenantContext,
    identity: req.identity,
  });
  if (
    membership.status !== "found" ||
    !["TENANT_ADMIN", "SUPER_ADMIN"].includes(membership.membership.role)
  ) {
    return null;
  }

  return {
    prisma,
    reader,
    tenantContext: req.tenantContext,
    identity: createAuthenticatedIdentity(
      req.identity.subjectId,
      membership.membership.profileId,
    ),
  };
}

type AdminContext = {
  prisma: ReturnType<typeof getPrisma>;
  reader: ReturnType<typeof createPrismaMembershipReader>;
  tenantContext: TenantContext;
  identity: ReturnType<typeof createAuthenticatedIdentity>;
};

function crm(context: AdminContext) {
  return createCalendarCrm({
    repository: createPrismaCalendarCrmRepository(context.prisma),
    authorizer: {
      async authorize(identity, tenantContext, role) {
        const result = await enforceServerAuthorization(
          { identity, tenantContext, requiredRole: role },
          context.reader,
        );
        return result.authorization.status === "allowed";
      },
    },
  });
}

export async function getCustomers(query: string) {
  const contextResult = await context();
  if (!contextResult) return { status: "UNAUTHORIZED" as const };
  return crm(contextResult).customers(
    contextResult.identity,
    contextResult.tenantContext,
    query,
  );
}

export async function getCustomer(id: string) {
  const contextResult = await context();
  if (!contextResult) return { status: "UNAUTHORIZED" as const };
  return crm(contextResult).customer(
    contextResult.identity,
    contextResult.tenantContext,
    id,
  );
}

export async function addCustomerNote(id: string, body: string) {
  const contextResult = await context();
  if (!contextResult) return { status: "UNAUTHORIZED" as const };
  return crm(contextResult).addNote(
    contextResult.identity,
    contextResult.tenantContext,
    id,
    body,
  );
}
