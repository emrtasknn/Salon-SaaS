import type { NotificationRepository, PushNotificationRepository } from "../application/notification-service";
import type { NotificationChannel, NotificationEventType, NotificationRecipient } from "../domain/notification";
import { selectPushRecipients } from "../domain/web-push";
import type { TenantContext } from "../domain/tenant-context";
import { DEFAULT_NOTIFICATION_EVENT_KEY, dedupeRecipients } from "../domain/notification";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  tenant: { findUnique(args: { where: { id: string } }): Promise<{ id: string; timezone: string } | null> };
  appointment: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } }; include: unknown }): Promise<{
    startAt: Date;
    customerProfile: { id: string; displayName: string; phone: string | null };
    staff: { profile: { id: string; displayName: string; phone: string | null } };
    service: { name: string };
    contact: { displayName: string; phone: string | null; whatsappOptIn: boolean; optOutAt: Date | null } | null;
  } | null> };
  tenantMembership: {
    findMany(args: { where: { tenantId: string; role: "TENANT_ADMIN" }; include: { profile: true }; orderBy: { profileId: "asc" } }): Promise<Array<{
      profileId: string;
      profile: { id: string; displayName: string; phone: string | null };
    }>>;
  };
  notificationDelivery: {
    findUnique(args: { where: { tenantId_appointmentId_eventType_channel_recipientProfileId_eventKey: { tenantId: string; appointmentId: string; eventType: NotificationEventType; channel: NotificationChannel; recipientProfileId: string; eventKey: string } } }): Promise<{ status: "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "UNKNOWN" } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
};

/** Exact delivery row for the mark* updates; eventKey defaults to the one-off key. */
function deliveryWhere(
  tenantContext: TenantContext,
  input: Readonly<{ appointmentId: string; eventType: NotificationEventType; eventKey?: string; channel: NotificationChannel; recipientProfileId: string }>,
) {
  return {
    tenantId: tenantContext.tenantId,
    appointmentId: input.appointmentId,
    eventType: input.eventType,
    eventKey: input.eventKey ?? DEFAULT_NOTIFICATION_EVENT_KEY,
    channel: input.channel,
    recipientProfileId: input.recipientProfileId,
  };
}

export function createPrismaNotificationRepository(prisma: PrismaTenantClient): NotificationRepository {
  return {
    async recipients(tenantContext, appointmentId, eventType) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const appointment = await tx.appointment.findUnique({
          where: { tenantId_id: { tenantId: tenantContext.tenantId, id: appointmentId } },
          include: { customerProfile: true, staff: { include: { profile: true } }, service: true, contact: true },
        });
        if (!appointment) return [];
        const tenant = await tx.tenant.findUnique({ where: { id: tenantContext.tenantId } });
        if (!tenant) return [];
        // WP-10: customer WhatsApp goes only to the booking's contact-snapshot phone, and only with an
        // active opt-in record. Never falls back to Profile.phone (no opt-in record -> no customer delivery).
        const contact = appointment.contact;
        const customerPhone = contact && contact.whatsappOptIn && contact.optOutAt === null && contact.phone ? contact.phone : null;
        // WP-10 follow-up: staff/admin messages name the customer as entered for this booking
        // (contact snapshot), falling back to the CRM profile name for pre-WP-10 bookings.
        const customer = { profileId: appointment.customerProfile.id, displayName: contact?.displayName ?? appointment.customerProfile.displayName, phone: customerPhone };
        const staff = { profileId: appointment.staff.profile.id, displayName: appointment.staff.profile.displayName, phone: appointment.staff.profile.phone };
        const serviceName = appointment.service.name;
        const time = new Intl.DateTimeFormat("tr-TR", { timeZone: tenant.timezone, dateStyle: "short", timeStyle: "short" }).format(appointment.startAt);

        if (eventType === "APPOINTMENT_CREATED") {
          const staffBody = `Yeni randevu talebi: ${customer.displayName} — ${serviceName} — ${time}. Onay bekliyor.`;
          const staffParameters = [customer.displayName, serviceName, time];
          const staffRecipient: NotificationRecipient = { profileId: staff.profileId, displayName: staff.displayName, phone: staff.phone, templateKey: "appointment-created-staff", body: staffBody, templateParameters: staffParameters };
          const customerRecipient: NotificationRecipient | null = customer.phone === null ? null : { profileId: customer.profileId, displayName: customer.displayName, phone: customer.phone, templateKey: "appointment-created-customer", body: `Randevu talebiniz oluşturuldu ve onay bekliyor. ${serviceName} — ${time}.`, templateParameters: [serviceName, time, staff.displayName] };
          // Tenant id comes from the trusted server context; explicit filter is defence in depth on top of RLS.
          const adminMemberships = await tx.tenantMembership.findMany({
            where: { tenantId: tenantContext.tenantId, role: "TENANT_ADMIN" },
            include: { profile: true },
            orderBy: { profileId: "asc" },
          });
          const admins: NotificationRecipient[] = adminMemberships
            .filter((membership) => membership.profile.phone !== null && membership.profile.phone.trim() !== "")
            .map((membership) => ({ profileId: membership.profile.id, displayName: membership.profile.displayName, phone: membership.profile.phone, templateKey: "appointment-created-staff", body: staffBody, templateParameters: [...staffParameters] }));
          return dedupeRecipients({ staff: staffRecipient, customer: customerRecipient, admins });
        }

        if (customer.phone === null) return [];
        const base = { profileId: customer.profileId, displayName: customer.displayName, phone: customer.phone };
        if (eventType === "APPOINTMENT_CONFIRMED") {
          return [{ ...base, templateKey: "appointment-confirmed-customer", body: `Randevunuz onaylandı. ${serviceName} — ${time} — ${staff.displayName}.`, templateParameters: [serviceName, time, staff.displayName] }];
        }
        if (eventType === "APPOINTMENT_RESCHEDULED") {
          // Owner decision 2026-11-05: same opt-in rule as CONFIRMED; `time` is the appointment's
          // current (new) start. Meta template not created yet: without a WHATSAPP_TEMPLATES_JSON
          // entry the provider rejects with WHATSAPP_TEMPLATE_NOT_CONFIGURED (a FAILED delivery).
          return [{ ...base, templateKey: "appointment-rescheduled-customer", body: `Randevunuzun saati değişti. ${serviceName} — ${time} — ${staff.displayName}.`, templateParameters: [serviceName, time, staff.displayName] }];
        }
        return [{ ...base, templateKey: "appointment-rejected-customer", body: `Randevu talebiniz onaylanmadı. ${serviceName} — ${time}.`, templateParameters: [serviceName, time] }];
      });
    },

    async claim(tenantContext, input) {
      try {
        return await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
          const eventKey = input.eventKey ?? DEFAULT_NOTIFICATION_EVENT_KEY;
          const where = {
            tenantId_appointmentId_eventType_channel_recipientProfileId_eventKey: {
              tenantId: tenantContext.tenantId,
              appointmentId: input.appointmentId,
              eventType: input.eventType,
              channel: input.channel,
              recipientProfileId: input.recipientProfileId,
              eventKey,
            },
          };
          const existing = await tx.notificationDelivery.findUnique({ where });

          if (existing?.status === "SENT" || existing?.status === "DELIVERED") return "already_sent";
          if (existing?.status === "PENDING") return "already_pending";
          if (existing?.status === "UNKNOWN") return "already_unknown";

          if (!existing) {
            await tx.notificationDelivery.create({
              data: {
                tenantId: tenantContext.tenantId,
                appointmentId: input.appointmentId,
                eventType: input.eventType,
                eventKey,
                channel: input.channel,
                recipientProfileId: input.recipientProfileId,
                templateKey: input.templateKey,
                status: "PENDING",
                attemptCount: 0,
              },
            });
          } else {
            await tx.notificationDelivery.updateMany({
              where: {
                tenantId: tenantContext.tenantId,
                appointmentId: input.appointmentId,
                eventType: input.eventType,
                eventKey,
                channel: input.channel,
                recipientProfileId: input.recipientProfileId,
              },
              data: { status: "PENDING" },
            });
          }

          return "claimed";
        });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return "already_pending";
        throw error;
      }
    },

    async markSent(tenantContext, input) {
      await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        await tx.notificationDelivery.updateMany({
          where: deliveryWhere(tenantContext, input),
          data: { status: "SENT", providerMessageId: input.providerMessageId, attemptCount: { increment: 1 }, lastErrorCode: null },
        });
      });
    },

    async markFailed(tenantContext, input) {
      await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        await tx.notificationDelivery.updateMany({
          where: deliveryWhere(tenantContext, input),
          data: { status: "FAILED", attemptCount: { increment: 1 }, lastErrorCode: input.errorCode },
        });
      });
    },

    async markUnknown(tenantContext, input) {
      await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        await tx.notificationDelivery.updateMany({
          where: deliveryWhere(tenantContext, input),
          data: { status: "UNKNOWN", attemptCount: { increment: 1 }, lastErrorCode: input.errorCode },
        });
      });
    },
  };
}

type PushRoutingTx = PrismaTenantTransactionClient & {
  tenant: { findUnique(args: { where: { id: string }; select: { timezone: true } }): Promise<{ timezone: string } | null> };
  appointment: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } }; select: unknown }): Promise<{
    id: string;
    startAt: Date;
    service: { name: string };
    staff: { profileId: string; status: "ACTIVE" | "INACTIVE" };
  } | null> };
  tenantMembership: {
    findMany(args: { where: Record<string, unknown>; select: { profileId: true; role: true }; orderBy: { profileId: "asc" } }): Promise<Array<{
      profileId: string;
      role: "SUPER_ADMIN" | "TENANT_ADMIN" | "STAFF" | "CUSTOMER";
    }>>;
  };
};

/**
 * WP-09 send-time Web Push routing for APPOINTMENT_CREATED (ADR-044 §4.4, §10-3),
 * read inside the caller tenant transaction. No customer data is selected.
 */
export async function readPushRecipients(
  prisma: PrismaTenantClient,
  tenantContext: TenantContext,
  appointmentId: string,
): ReturnType<PushNotificationRepository["pushRecipients"]> {
  return withPrismaTenantContext(prisma, tenantContext, async (tx: PushRoutingTx) => {
    const appointment = await tx.appointment.findUnique({
      where: { tenantId_id: { tenantId: tenantContext.tenantId, id: appointmentId } },
      select: { id: true, startAt: true, service: { select: { name: true } }, staff: { select: { profileId: true, status: true } } },
    });
    if (!appointment) return null;
    const tenant = await tx.tenant.findUnique({ where: { id: tenantContext.tenantId }, select: { timezone: true } });
    if (!tenant) return null;
    // Tenant id comes from the trusted server context; explicit filter is defence in depth on top of RLS.
    const memberships = await tx.tenantMembership.findMany({
      where: {
        tenantId: tenantContext.tenantId,
        OR: [{ role: "TENANT_ADMIN" }, { profileId: appointment.staff.profileId, role: { in: ["STAFF", "TENANT_ADMIN"] } }],
      },
      select: { profileId: true, role: true },
      orderBy: { profileId: "asc" },
    });
    const adminProfileIds = memberships.filter((membership) => membership.role === "TENANT_ADMIN").map((membership) => membership.profileId);
    const staffHasMembership = memberships.some((membership) => membership.profileId === appointment.staff.profileId);
    return {
      appointment: { id: appointment.id, serviceName: appointment.service.name, startAt: appointment.startAt, timeZone: tenant.timezone },
      recipients: selectPushRecipients({
        assignedStaff: { profileId: appointment.staff.profileId, status: appointment.staff.status, hasMembership: staffHasMembership },
        adminProfileIds,
      }),
    };
  });
}
