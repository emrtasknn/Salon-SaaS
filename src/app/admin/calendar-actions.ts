"use server";

import { createCalendarCrm } from "../../application/calendar-crm";
import { createBookingEngine } from "../../application/booking-engine";
import { enforceServerAuthorization } from "../../application/server-authorization-enforcement";
import { createPrismaCalendarCrmRepository } from "../../persistence/prisma-calendar-crm";
import { createPrismaBookingRepository } from "../../persistence/prisma-booking-engine";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { localWallTimeToUtc } from "../../domain/availability";
import { createAuthenticatedIdentity, type ApplicationIdentity } from "../../domain/auth-identity";
import type { AppointmentStatus } from "../../domain/appointment";

async function getAdminContext() {
  const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
  const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
  if (request.state !== "authenticated") return null;
  const prisma = getPrisma();
  const reader = createPrismaMembershipReader({ prisma });
  const membership = await reader.readMembership({ tenantContext: request.tenantContext, identity: request.identity });
  if (membership.status !== "found" || !["TENANT_ADMIN", "SUPER_ADMIN"].includes(membership.membership.role)) return null;
  return { prisma, reader, tenantContext: request.tenantContext, identity: createAuthenticatedIdentity(request.identity.subjectId, membership.membership.profileId) };
}

function calendar(prisma: ReturnType<typeof getPrisma>, reader: ReturnType<typeof createPrismaMembershipReader>) {
  return createCalendarCrm({
    repository: createPrismaCalendarCrmRepository(prisma),
    authorizer: {
      async authorize(identity, tenantContext, requiredRole) {
        const result = await enforceServerAuthorization({ identity, tenantContext, requiredRole }, reader);
        return result.authorization.status === "allowed";
      },
    },
  });
}

function booking(prisma: ReturnType<typeof getPrisma>, reader: ReturnType<typeof createPrismaMembershipReader>) {
  const repository = createPrismaBookingRepository(prisma);
  return createBookingEngine({
    repository,
    authorizer: {
      async authorize(identity, tenantContext, requiredRole) {
        const result = await enforceServerAuthorization({ identity, tenantContext, requiredRole }, reader);
        return result.authorization.status === "allowed";
      },
      async authorizeStaffDecision(identity, tenantContext, appointment) {
        if (identity.state !== "authenticated") return false;
        const membership = await reader.readMembership({ tenantContext, identity });
        if (membership.status !== "found" || membership.membership.role !== "STAFF") return false;
        const staff = await prisma.staff.findUnique({
          where: { tenantId_profileId: { tenantId: tenantContext.tenantId, profileId: membership.membership.profileId } },
        });
        return staff !== null && staff.status === "ACTIVE" && staff.id === appointment.staffId && staff.tenantId === appointment.tenantId && appointment.status === "PENDING";
      },
    },
  });
}

export async function listAdminAppointments(dateIso: string, staffId?: string) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return { status: "INVALID_INPUT" as const };
  const tenant = await context.prisma.tenant.findUnique({ where: { id: context.tenantContext.tenantId } });
  if (!tenant) return { status: "NOT_FOUND" as const };
  const startAt = localWallTimeToUtc(dateIso, 0, tenant.timezone);
  const endAt = localWallTimeToUtc(dateIso, 1439, tenant.timezone);
  return calendar(context.prisma, context.reader).calendar(context.identity, context.tenantContext, { startAt, endAt });
}

export async function transitionAdminAppointment(
  appointment: Readonly<{ id: string; tenantId: string; staffId: string; serviceId: string; customerProfileId: string; startAt: Date; endAt: Date; status: AppointmentStatus }>,
  to: AppointmentStatus,
) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  return booking(context.prisma, context.reader).transition(context.identity, context.tenantContext, appointment, to);
}
