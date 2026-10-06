"use server";

import { createBookingEngine } from "../../application/booking-engine";
import { createStaffAppointments } from "../../application/staff-appointments";
import { enforceServerAuthorization } from "../../application/server-authorization-enforcement";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { createPrismaStaffAppointmentsRepository } from "../../persistence/prisma-staff-appointments";
import { createPrismaBookingRepository } from "../../persistence/prisma-booking-engine";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import type { ApplicationIdentity } from "../../domain/auth-identity";
import type { AppointmentRecord, AppointmentStatus } from "../../domain/appointment";

async function getStaffContext() {
  const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
  const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
  if (request.state !== "authenticated") return null;
  const prisma = getPrisma();
  const reader = createPrismaMembershipReader({ prisma });
  const membership = await reader.readMembership({ tenantContext: request.tenantContext, identity: request.identity });
  if (membership.status !== "found" || membership.membership.role !== "STAFF") return null;
  const staff = await prisma.staff.findUnique({
    where: { tenantId_profileId: { tenantId: request.tenantContext.tenantId, profileId: membership.membership.profileId } },
  });
  if (!staff || staff.status !== "ACTIVE") return null;
  return {
    prisma, reader, staffId: staff.id, tenantContext: request.tenantContext,
    identity: { state: "authenticated" as const, subjectId: request.identity.subjectId, profileId: membership.membership.profileId } as ApplicationIdentity,
  };
}

function staffAppointments(prisma: ReturnType<typeof getPrisma>, reader: ReturnType<typeof createPrismaMembershipReader>) {
  return createStaffAppointments({
    repository: createPrismaStaffAppointmentsRepository(prisma),
    authorizer: {
      async authorizeStaffDecision(identity, tenantContext, appointment) {
        const membership = await reader.readMembership({ tenantContext, identity });
        if (membership.status !== "found" || membership.membership.role !== "STAFF") return false;
        const staff = await prisma.staff.findUnique({ where: { tenantId_profileId: { tenantId: tenantContext.tenantId, profileId: membership.membership.profileId } } });
        return !!staff && staff.status === "ACTIVE" && staff.id === appointment.staffId && appointment.tenantId === tenantContext.tenantId;
      },
      async authorizeAdmin(identity, tenantContext) {
        const result = await enforceServerAuthorization({ identity, tenantContext, requiredRole: "TENANT_ADMIN" }, reader);
        return result.authorization.status === "allowed";
      },
    },
  });
}

function booking(prisma: ReturnType<typeof getPrisma>, reader: ReturnType<typeof createPrismaMembershipReader>) {
  return createBookingEngine({
    repository: createPrismaBookingRepository(prisma),
    authorizer: {
      async authorize(identity, tenantContext, requiredRole) {
        const result = await enforceServerAuthorization({ identity, tenantContext, requiredRole }, reader);
        return result.authorization.status === "allowed";
      },
      async authorizeStaffDecision(identity, tenantContext, appointment) {
        const membership = await reader.readMembership({ tenantContext, identity });
        if (membership.status !== "found" || membership.membership.role !== "STAFF") return false;
        const staff = await prisma.staff.findUnique({ where: { tenantId_profileId: { tenantId: tenantContext.tenantId, profileId: membership.membership.profileId } } });
        return !!staff && staff.status === "ACTIVE" && staff.id === appointment.staffId && appointment.tenantId === tenantContext.tenantId && appointment.status === "PENDING";
      },
    },
  });
}

export async function listStaffAppointments(dateIso: string) {
  const context = await getStaffContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return { status: "INVALID_INPUT" as const };
  const tenant = await context.prisma.tenant.findUnique({ where: { id: context.tenantContext.tenantId } });
  if (!tenant) return { status: "NOT_FOUND" as const };
  const { localWallTimeToUtc } = await import("../../domain/availability");
  const startAt = localWallTimeToUtc(dateIso, 0, tenant.timezone);
  const endAt = localWallTimeToUtc(dateIso, 1439, tenant.timezone);
  return staffAppointments(context.prisma, context.reader).list(context.identity, context.tenantContext, context.staffId, { startAt, endAt });
}

export async function decideStaffAppointment(
  appointment: AppointmentRecord,
  to: Extract<AppointmentStatus, "CONFIRMED" | "REJECTED">,
) {
  const context = await getStaffContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  const checked = await staffAppointments(context.prisma, context.reader).decide(context.identity, context.tenantContext, appointment.id, to);
  if (checked.status !== "AUTHORIZED") return checked;
  return booking(context.prisma, context.reader).transition(context.identity, context.tenantContext, appointment, to);
}
