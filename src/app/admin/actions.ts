"use server";

import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createAuthenticatedIdentity } from "../../domain/auth-identity";
import { createServiceManager } from "../../application/service-management";
import { enforceServerAuthorization } from "../../application/server-authorization-enforcement";
import { createStaffManager } from "../../application/staff-management";
import { createWorkingHoursManager } from "../../application/working-hours-management";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { createPrismaServiceRepository } from "../../persistence/prisma-service-management";
import { createPrismaStaffRepository } from "../../persistence/prisma-staff-management";
import { createPrismaWorkingHoursRepository } from "../../persistence/prisma-working-hours-management";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { createSupabaseAdminAuthProvisioner } from "../../infrastructure/auth/supabase-admin-auth";
import { getPrisma } from "../../infrastructure/prisma-runtime";

async function getAdminContext() {
  const supabase = await createNextSupabaseServerClient(
    readSupabaseServerClientConfig(),
  );
  const request = await readAuthenticatedTenantRequest(
    createSupabaseAuthAdapter({ client: supabase as never }),
  );
  if (request.state !== "authenticated") return null;

  const prisma = getPrisma();
  const membershipReader = createPrismaMembershipReader({ prisma });
  const membership = await membershipReader.readMembership({
    tenantContext: request.tenantContext,
    identity: request.identity,
  });
  if (membership.status !== "found") return null;

  if (
    membership.membership.role !== "TENANT_ADMIN" &&
    membership.membership.role !== "SUPER_ADMIN"
  ) {
    return null;
  }

  return {
    prisma,
    tenantContext: request.tenantContext,
    identity: createAuthenticatedIdentity(
      request.identity.subjectId,
      membership.membership.profileId,
    ),
  };
}

function services(prisma: ReturnType<typeof getPrisma>) {
  return createServiceManager({
    authorizer: {
      async authorize(identity, tenantContext, requiredRole) {
        const reader = createPrismaMembershipReader({ prisma });
        const decision = await enforceServerAuthorization(
          { identity, tenantContext, requiredRole },
          reader,
        );
        return decision.authorization.status === "allowed";
      },
    },
    repository: createPrismaServiceRepository(prisma),
  });
}

function workingHours(prisma: ReturnType<typeof getPrisma>) {
  return createWorkingHoursManager({
    authorizer: {
      async authorize(identity, tenantContext, requiredRole) {
        const reader = createPrismaMembershipReader({ prisma });
        const decision = await enforceServerAuthorization(
          { identity, tenantContext, requiredRole },
          reader,
        );
        return decision.authorization.status === "allowed";
      },
    },
    repository: createPrismaWorkingHoursRepository(prisma),
  });
}

function staff(prisma: ReturnType<typeof getPrisma>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey)
    throw new Error("Supabase admin environment is not configured");
  return createStaffManager({
    authorizer: {
      async authorize(identity, tenantContext, requiredRole) {
        const reader = createPrismaMembershipReader({ prisma });
        const decision = await enforceServerAuthorization(
          { identity, tenantContext, requiredRole },
          reader,
        );
        return decision.authorization.status === "allowed";
      },
    },
    authProvisioner: createSupabaseAdminAuthProvisioner({
      url,
      serviceRoleKey,
    }),
    repository: createPrismaStaffRepository(prisma),
  });
}

export async function listAdminData() {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };

  const [serviceResult, hoursResult, staffResult] = await Promise.all([
    services(context.prisma).list(context.identity, context.tenantContext),
    workingHours(context.prisma).list(context.identity, context.tenantContext),
    staff(context.prisma).list(context.identity, context.tenantContext),
  ]);

  return {
    status: "ok" as const,
    services: serviceResult,
    workingHours: hoursResult,
    staff: staffResult,
  };
}

export async function createServiceAction(input: {
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
}) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  return services(context.prisma).create({
    identity: context.identity,
    tenantContext: context.tenantContext,
    ...input,
  });
}

export async function toggleServiceAction(serviceId: string, active: boolean) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  return services(context.prisma).setActive(
    context.identity,
    context.tenantContext,
    serviceId,
    active,
  );
}

export async function updateServiceAction(
  serviceId: string,
  input: {
    name?: string;
    durationMinutes?: number;
    bufferMinutes?: number;
  },
) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  return services(context.prisma).update({
    identity: context.identity,
    tenantContext: context.tenantContext,
    serviceId,
    ...input,
  });
}

export async function saveWorkingHoursAction(input: {
  dayOfWeek: number;
  openMinute: number;
  closeMinute: number;
}) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  return workingHours(context.prisma).upsert(
    context.identity,
    context.tenantContext,
    input,
  );
}

export async function removeWorkingHoursAction(dayOfWeek: number) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  return workingHours(context.prisma).remove(
    context.identity,
    context.tenantContext,
    dayOfWeek,
  );
}

export async function createStaffAction(input: {
  displayName: string;
  email?: string;
  phone?: string;
}) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  return staff(context.prisma).create({
    identity: context.identity,
    tenantContext: context.tenantContext,
    ...input,
  });
}

export async function setStaffStatusAction(
  staffId: string,
  status: "ACTIVE" | "INACTIVE",
) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  return staff(context.prisma).setStatus(
    context.identity,
    context.tenantContext,
    staffId,
    status,
  );
}

export async function updateStaffProfileAction(
  staffId: string,
  input: { displayName: string; phone?: string },
) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };

  return staff(context.prisma).updateProfile(
    context.identity,
    context.tenantContext,
    staffId,
    {
      displayName: input.displayName,
      phone: input.phone,
    },
  );
}
