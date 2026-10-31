"use server";

import { createBookingEngine } from "../../application/booking-engine";
import { createStaffAppointments } from "../../application/staff-appointments";
import { authorizeStaffDecision } from "../../application/staff-appointment-authorization";
import { enforceServerAuthorization } from "../../application/server-authorization-enforcement";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { createPrismaStaffAppointmentsRepository } from "../../persistence/prisma-staff-appointments";
import { createPrismaBookingRepository } from "../../persistence/prisma-booking-engine";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { createAuthenticatedIdentity } from "../../domain/auth-identity";
import type { AppointmentStatus } from "../../domain/appointment";

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
    identity: createAuthenticatedIdentity(request.identity.subjectId, membership.membership.profileId),
  };
}


function staffDecisionAuthorization(
  prisma: ReturnType<typeof getPrisma>,
  reader: ReturnType<typeof createPrismaMembershipReader>,
) {
  return {
    membershipReader: reader,
    staffReader: {
      async findByProfileId(tenantContext: Parameters<typeof authorizeStaffDecision>[2], profileId: string) {
        return prisma.staff.findUnique({
          where: { tenantId_profileId: { tenantId: tenantContext.tenantId, profileId } },
        });
      },
    },
  };
}

function staffAppointments(prisma: ReturnType<typeof getPrisma>, reader: ReturnType<typeof createPrismaMembershipReader>) {
  return createStaffAppointments({
    repository: createPrismaStaffAppointmentsRepository(prisma),
    authorizer: {
      async authorizeStaffDecision(identity, tenantContext, appointment) {
        return authorizeStaffDecision(
          staffDecisionAuthorization(prisma, reader),
          identity,
          tenantContext,
          appointment,
        );
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
        return authorizeStaffDecision(
          staffDecisionAuthorization(prisma, reader),
          identity,
          tenantContext,
          appointment,
        );
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
  appointmentId: string,
  to: Extract<AppointmentStatus, "CONFIRMED" | "REJECTED">,
) {
  const context = await getStaffContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  if (typeof appointmentId !== "string" || !appointmentId.trim() || appointmentId.length > 100 || /[\u0000-\u001f\u007f]/.test(appointmentId)) {
    return { status: "INVALID_INPUT" as const };
  }
  const checked = await staffAppointments(context.prisma, context.reader).decide(context.identity, context.tenantContext, appointmentId, to);
  if (checked.status !== "AUTHORIZED") return checked;
  const result = await booking(context.prisma, context.reader).transition(context.identity, context.tenantContext, checked.appointment, to);
  return result.status === "updated" ? { ...result, tenantId: context.tenantContext.tenantId } : result;
}
