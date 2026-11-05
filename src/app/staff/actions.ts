"use server";

import { createBookingEngine } from "../../application/booking-engine";
import { createStaffAppointments } from "../../application/staff-appointments";
import { createInAppNotifications, toInAppNotificationView, type InAppNotificationView } from "../../application/in-app-notifications";
import { authorizeStaffDecision } from "../../application/staff-appointment-authorization";
import { enforceServerAuthorization } from "../../application/server-authorization-enforcement";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { createPrismaStaffAppointmentsRepository } from "../../persistence/prisma-staff-appointments";
import { createPrismaBookingRepository } from "../../persistence/prisma-booking-engine";
import { createPrismaInAppNotificationRepository } from "../../persistence/prisma-in-app-notifications";
import { findStaffByProfileId } from "../../persistence/prisma-staff-lookup";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { createAuthenticatedIdentity } from "../../domain/auth-identity";
import { isStaffWorkspaceRole } from "../../domain/staff-workspace";
import type { AppointmentStatus } from "../../domain/appointment";
import { parseCalendarRange } from "../_ui/timeline-layout";
import { createOnBehalf, createOnBehalfBookingEngine, listSlotsOnBehalf, readCreateOptions, rescheduleOnBehalf, type RescheduleView } from "../appointment-create-runtime";
import type {
  CreateAppointmentResult, CreateOptionsView, LocalDateIso, SlotListResult, StaffCreateAppointmentInput,
} from "../appointment-create-contract";

/**
 * Staff workspace context: STAFF, or a TENANT_ADMIN who also serves customers (owner decision
 * 2026-11-05). Both always need their own ACTIVE Staff row in the session tenant; staffId is
 * read server-side from the membership profile, never from client input.
 */
async function getStaffContext() {
  const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
  const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
  if (request.state !== "authenticated") return null;
  const prisma = getPrisma();
  const reader = createPrismaMembershipReader({ prisma });
  const membership = await reader.readMembership({ tenantContext: request.tenantContext, identity: request.identity });
  if (membership.status !== "found" || !isStaffWorkspaceRole(membership.membership.role)) return null;
  const staff = await findStaffByProfileId(prisma, request.tenantContext, membership.membership.profileId);
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
        return findStaffByProfileId(prisma, tenantContext, profileId);
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
      // Transitions only; create-on-behalf uses createOnBehalfBookingEngine (WP-08).
      async resolveCreateScope() { return null; },
    },
  });
}

/**
 * The signed-in staff member's own appointments for an inclusive local date range (YYYY-MM-DD,
 * tenant timezone). `endDate` defaults to `startDate`; span capped at CALENDAR_RANGE_MAX_DAYS.
 * staffId always comes from the server-side context, never from the client.
 */
export async function listStaffAppointments(startDate: string, endDate?: string) {
  const context = await getStaffContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  const range = parseCalendarRange(startDate, endDate);
  if (!range) return { status: "INVALID_INPUT" as const };
  const tenant = await context.prisma.tenant.findUnique({ where: { id: context.tenantContext.tenantId } });
  if (!tenant) return { status: "NOT_FOUND" as const };
  const { localWallTimeToUtc } = await import("../../domain/availability");
  const startAt = localWallTimeToUtc(range.startDate, 0, tenant.timezone);
  const endAt = localWallTimeToUtc(range.endDate, 1439, tenant.timezone);
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

/**
 * WP-04: in-app notifications for the signed-in staff member (own appointments only).
 * No arguments: tenant and staffId come only from trusted server context (WP4-R5).
 * Returns InAppNotificationView; staff items never include customerDisplayName.
 */
export async function listStaffNotifications(): Promise<InAppNotificationView> {
  try {
    const context = await getStaffContext();
    if (!context) return { status: "UNAUTHORIZED" };
    const { prisma, reader } = context;
    const notifications = createInAppNotifications({
      repository: createPrismaInAppNotificationRepository(prisma),
      authorizer: {
        async authorizeAdmin() {
          return false;
        },
        async authorizeStaffScope(identity, tenantContext, staffId) {
          if (identity.state !== "authenticated") return false;
          const membership = await reader.readMembership({ tenantContext, identity });
          if (membership.status !== "found" || !isStaffWorkspaceRole(membership.membership.role)) return false;
          const staff = await findStaffByProfileId(prisma, tenantContext, membership.membership.profileId);
          return staff !== null && staff.status === "ACTIVE" && staff.id === staffId && staff.tenantId === tenantContext.tenantId;
        },
      },
    });
    return toInAppNotificationView(await notifications.forStaff(context.identity, context.tenantContext, context.staffId));
  } catch {
    return { status: "PERSISTENCE_FAILURE" };
  }
}

/** WP-08: services + only the signed-in staff member. Tenant and staff come from server context. */
export async function getStaffCreateOptions(): Promise<CreateOptionsView | null> {
  const context = await getStaffContext();
  if (!context) return null;
  return readCreateOptions(createOnBehalfBookingEngine(context.prisma, context.reader), context.identity, context.tenantContext);
}

/** WP-08: free slots for the signed-in staff member only (no staffId accepted from the client). */
export async function listStaffSlots(input: { serviceId: string; date: LocalDateIso }): Promise<SlotListResult> {
  const context = await getStaffContext();
  if (!context) return { status: "FORBIDDEN" };
  if (typeof input !== "object" || input === null) return { status: "INVALID_INPUT" };
  return listSlotsOnBehalf(createOnBehalfBookingEngine(context.prisma, context.reader), context.identity, context.tenantContext, {
    serviceId: input.serviceId, staffId: context.staffId, date: input.date,
  });
}

/**
 * WP-08: staff create for themselves only (decision e), guest customer without email; starts CONFIRMED.
 * staffId is the server-side context value; the engine re-derives and compares it as well.
 */
export async function createStaffAppointment(input: StaffCreateAppointmentInput): Promise<CreateAppointmentResult> {
  const context = await getStaffContext();
  if (!context) return { status: "FORBIDDEN" };
  if (typeof input !== "object" || input === null) return { status: "INVALID_INPUT" };
  return createOnBehalf(createOnBehalfBookingEngine(context.prisma, context.reader), context.identity, context.tenantContext, {
    serviceId: input.serviceId, staffId: context.staffId, startAt: input.startAt, customer: input.customer, notifyCustomer: input.notifyCustomer,
    whatsappVerbalOptIn: input.whatsappVerbalOptIn,
  });
}

/** Drag-to-move in the day calendar (owner decision 2026-11-05). No customer notification yet. */
export async function rescheduleStaffAppointment(appointmentId: string, newStartAtIso: string): Promise<RescheduleView> {
  const context = await getStaffContext();
  if (!context) return { status: "FORBIDDEN" };
  return rescheduleOnBehalf(
    context.prisma, createOnBehalfBookingEngine(context.prisma, context.reader), context.identity, context.tenantContext,
    appointmentId, newStartAtIso,
  );
}
