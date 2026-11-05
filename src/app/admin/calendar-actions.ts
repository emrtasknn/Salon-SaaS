"use server";

import { createCalendarCrm } from "../../application/calendar-crm";
import { createInAppNotifications, toInAppNotificationView, type InAppNotificationView } from "../../application/in-app-notifications";
import { createBookingEngine } from "../../application/booking-engine";
import { enforceServerAuthorization } from "../../application/server-authorization-enforcement";
import { createPrismaCalendarCrmRepository } from "../../persistence/prisma-calendar-crm";
import { createPrismaBookingRepository } from "../../persistence/prisma-booking-engine";
import { createPrismaInAppNotificationRepository } from "../../persistence/prisma-in-app-notifications";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { findStaffByProfileId } from "../../persistence/prisma-staff-lookup";
import { withPrismaTenantContext, type PrismaTenantTransactionClient } from "../../persistence/prisma-tenant-context";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { localWallTimeToUtc } from "../../domain/availability";
import { parseCalendarRange } from "../_ui/timeline-layout";
import { createAuthenticatedIdentity } from "../../domain/auth-identity";
import type { AppointmentRecord, AppointmentStatus } from "../../domain/appointment";
import type { NotificationEventType } from "../../domain/notification";
import { publishAppointmentNotification } from "../notification-runtime";
import { createOnBehalf, createOnBehalfBookingEngine, listSlotsOnBehalf, readCreateOptions, rescheduleOnBehalf, type RescheduleView } from "../appointment-create-runtime";
import type {
  AdminCreateAppointmentInput, CreateAppointmentResult, CreateOptionsView, CustomerSearchResultView, LocalDateIso, SlotListResult,
} from "../appointment-create-contract";

type AppointmentLookupTx = PrismaTenantTransactionClient & {
  appointment: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<AppointmentRecord | null>;
  };
};

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
        const adminResult = await enforceServerAuthorization({ identity, tenantContext, requiredRole: "TENANT_ADMIN" }, reader);
        if (adminResult.authorization.status === "allowed") return true;
        if (identity.state !== "authenticated") return false;
        const membership = await reader.readMembership({ tenantContext, identity });
        if (membership.status !== "found" || membership.membership.role !== "STAFF") return false;
        const staff = await findStaffByProfileId(prisma, tenantContext, membership.membership.profileId);
        return staff !== null && staff.status === "ACTIVE" && staff.id === appointment.staffId && staff.tenantId === appointment.tenantId && appointment.status === "PENDING";
      },
      // Transitions only; create-on-behalf uses createOnBehalfBookingEngine (WP-08).
      async resolveCreateScope() { return null; },
    },
  });
}

/**
 * Appointments for an inclusive local date range (YYYY-MM-DD, tenant timezone). `endDate`
 * defaults to `startDate` (one day); the span is capped at CALENDAR_RANGE_MAX_DAYS (a month grid).
 * Same tenant-scoped query and TENANT_ADMIN authorization for every range.
 */
export async function listAdminAppointments(startDate: string, endDate?: string, staffId?: string) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  const range = parseCalendarRange(startDate, endDate);
  if (!range || (staffId !== undefined && typeof staffId !== "string")) return { status: "INVALID_INPUT" as const };
  const tenant = await context.prisma.tenant.findUnique({ where: { id: context.tenantContext.tenantId } });
  if (!tenant) return { status: "NOT_FOUND" as const };
  const startAt = localWallTimeToUtc(range.startDate, 0, tenant.timezone);
  const endAt = localWallTimeToUtc(range.endDate, 1439, tenant.timezone);
  return calendar(context.prisma, context.reader).calendar(context.identity, context.tenantContext, { startAt, endAt, staffId });
}

export async function transitionAdminAppointment(appointmentId: string, to: AppointmentStatus) {
  const context = await getAdminContext();
  if (!context) return { status: "UNAUTHORIZED" as const };
  if (typeof appointmentId !== "string" || !appointmentId.trim() || appointmentId.length > 100 || /[\u0000-\u001f\u007f]/.test(appointmentId)) {
    return { status: "INVALID_INPUT" as const };
  }

  const appointment = await withPrismaTenantContext(
    context.prisma,
    context.tenantContext,
    async (tx: AppointmentLookupTx) => tx.appointment.findUnique({
      where: { tenantId_id: { tenantId: context.tenantContext.tenantId, id: appointmentId } },
    }),
  );
  if (!appointment) return { status: "NOT_FOUND" as const };

  const result = await booking(context.prisma, context.reader).transition(
    context.identity,
    context.tenantContext,
    appointment,
    to,
  );

  if (result.status === "updated" && (to === "CONFIRMED" || to === "REJECTED")) {
    const eventType: NotificationEventType =
      to === "CONFIRMED" ? "APPOINTMENT_CONFIRMED" : "APPOINTMENT_REJECTED";
    await publishAppointmentNotification(context.tenantContext, appointmentId, eventType);
  }

  return result;
}

/**
 * WP-04: tenant-wide in-app notifications for TENANT_ADMIN.
 * No arguments: tenant comes only from trusted server context (WP4-R5);
 * authorization is re-checked via enforceServerAuthorization(..., "TENANT_ADMIN").
 * Returns InAppNotificationView; admin items include customerDisplayName.
 */
export async function listAdminNotifications(): Promise<InAppNotificationView> {
  try {
    const context = await getAdminContext();
    if (!context) return { status: "UNAUTHORIZED" };
    const { reader } = context;
    const notifications = createInAppNotifications({
      repository: createPrismaInAppNotificationRepository(context.prisma),
      authorizer: {
        async authorizeAdmin(identity, tenantContext) {
          const result = await enforceServerAuthorization({ identity, tenantContext, requiredRole: "TENANT_ADMIN" }, reader);
          return result.authorization.status === "allowed";
        },
        async authorizeStaffScope() {
          return false;
        },
      },
    });
    return toInAppNotificationView(await notifications.forAdmin(context.identity, context.tenantContext));
  } catch {
    return { status: "PERSISTENCE_FAILURE" };
  }
}

/**
 * WP-08: services + all ACTIVE staff for the admin create dialog. Tenant from trusted context.
 * Returns null when the caller is not TENANT_ADMIN (or SUPER_ADMIN) of the tenant.
 */
export async function getAdminCreateOptions(): Promise<CreateOptionsView | null> {
  const context = await getAdminContext();
  if (!context) return null;
  return readCreateOptions(createOnBehalfBookingEngine(context.prisma, context.reader), context.identity, context.tenantContext);
}

/** WP-08: free slots for any ACTIVE staff of the tenant (closures, working hours, conflicts applied). */
export async function listAdminSlots(input: { serviceId: string; staffId: string; date: LocalDateIso }): Promise<SlotListResult> {
  const context = await getAdminContext();
  if (!context) return { status: "FORBIDDEN" };
  if (typeof input !== "object" || input === null) return { status: "INVALID_INPUT" };
  return listSlotsOnBehalf(createOnBehalfBookingEngine(context.prisma, context.reader), context.identity, context.tenantContext, {
    serviceId: input.serviceId, staffId: input.staffId, date: input.date,
  });
}

/** WP-08: CRM customer search for the admin create dialog (TENANT_ADMIN-only CRM listing). */
export async function searchAdminCustomers(query: string): Promise<ReadonlyArray<CustomerSearchResultView>> {
  const context = await getAdminContext();
  if (!context) return [];
  const result = await calendar(context.prisma, context.reader).customers(context.identity, context.tenantContext, query);
  if (result.status !== "ok") return [];
  return result.customers.slice(0, 20).map((c) => ({ profileId: c.id, displayName: c.displayName, phone: c.phone, email: c.email }));
}

/**
 * WP-08: admin-created appointment for any ACTIVE staff; starts CONFIRMED. Existing CRM customer or
 * guest (a guest email matching an existing profile returns EMAIL_EXISTS, never attaches silently).
 */
export async function createAdminAppointment(input: AdminCreateAppointmentInput): Promise<CreateAppointmentResult> {
  const context = await getAdminContext();
  if (!context) return { status: "FORBIDDEN" };
  if (typeof input !== "object" || input === null) return { status: "INVALID_INPUT" };
  return createOnBehalf(createOnBehalfBookingEngine(context.prisma, context.reader), context.identity, context.tenantContext, {
    serviceId: input.serviceId, staffId: input.staffId, startAt: input.startAt, customer: input.customer, notifyCustomer: input.notifyCustomer,
    whatsappVerbalOptIn: input.whatsappVerbalOptIn,
  });
}

/** Drag-to-move in the day calendar (owner decision 2026-11-05). No customer notification yet. */
export async function rescheduleAdminAppointment(appointmentId: string, newStartAtIso: string): Promise<RescheduleView> {
  const context = await getAdminContext();
  if (!context) return { status: "FORBIDDEN" };
  return rescheduleOnBehalf(
    context.prisma, createOnBehalfBookingEngine(context.prisma, context.reader), context.identity, context.tenantContext,
    appointmentId, newStartAtIso,
  );
}
