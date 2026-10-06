"use server";

import { createCalendarCrm } from "../../../application/calendar-crm";
import { createAuthenticatedIdentity } from "../../../domain/auth-identity";
import { createPrismaCalendarCrmRepository } from "../../../persistence/prisma-calendar-crm";
import { createPrismaMembershipReader } from "../../../persistence/prisma-membership-reader";
import { createNextSupabaseServerClient } from "../../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../../infrastructure/auth/supabase-server-env";
import { readAuthenticatedTenantRequest } from "../../../application/auth-request-boundary";
import { getPrisma } from "../../../infrastructure/prisma-runtime";

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

function crm(context: NonNullable<Awaited<ReturnType<typeof context>>>) {
  return createCalendarCrm({
    repository: createPrismaCalendarCrmRepository(context.prisma),
    authorizer: {
      async authorize(identity, tenantContext, role) {
        const membership = await context.reader.readMembership({
          tenantContext,
          identity,
        });
        return (
          membership.status === "found" &&
          ["TENANT_ADMIN", "SUPER_ADMIN"].includes(membership.membership.role) &&
          role === "TENANT_ADMIN"
        );
      },
    },
  });
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
