import type { NotificationRepository } from "../application/notification-service";
import type { NotificationEventType } from "../domain/notification";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  tenant: { findUnique(args: { where: { id: string } }): Promise<{ id: string; timezone: string } | null> };
  appointment: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } }; include: unknown }): Promise<{
    startAt: Date;
    customerProfile: { id: string; displayName: string; phone: string | null };
    staff: { profile: { id: string; displayName: string; phone: string | null } };
    service: { name: string };
  } | null> };
  notificationDelivery: {
    findUnique(args: { where: { tenantId_appointmentId_eventType_channel_recipientProfileId: { tenantId: string; appointmentId: string; eventType: NotificationEventType; channel: "WHATSAPP"; recipientProfileId: string } } }): Promise<{ status: "PENDING" | "SENT" | "DELIVERED" | "FAILED" } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
};

export function createPrismaNotificationRepository(prisma: PrismaTenantClient): NotificationRepository {
  return {
    async recipients(tenantContext, appointmentId, eventType) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const appointment = await tx.appointment.findUnique({
          where: { tenantId_id: { tenantId: tenantContext.tenantId, id: appointmentId } },
          include: { customerProfile: true, staff: { include: { profile: true } }, service: true },
        });
        if (!appointment) return [];
        const tenant = await tx.tenant.findUnique({ where: { id: tenantContext.tenantId } });
        if (!tenant) return [];
        const customer = { profileId: appointment.customerProfile.id, displayName: appointment.customerProfile.displayName, phone: appointment.customerProfile.phone };
        const staff = { profileId: appointment.staff.profile.id, displayName: appointment.staff.profile.displayName, phone: appointment.staff.profile.phone };
        const serviceName = appointment.service.name;
        const time = new Intl.DateTimeFormat("tr-TR", { timeZone: tenant.timezone, dateStyle: "short", timeStyle: "short" }).format(appointment.startAt);
        if (eventType === "APPOINTMENT_CREATED") return [
          { profileId: staff.profileId, displayName: staff.displayName, phone: staff.phone, templateKey: "appointment-created-staff", body: `Yeni randevu talebi: ${customer.displayName} — ${serviceName} — ${time}. Onay bekliyor.`, templateParameters: [customer.displayName, serviceName, time] },
          { profileId: customer.profileId, displayName: customer.displayName, phone: customer.phone, templateKey: "appointment-created-customer", body: `Randevu talebiniz oluşturuldu ve onay bekliyor. ${serviceName} — ${time}.`, templateParameters: [serviceName, time] },
        ];
        return [{ profileId: customer.profileId, displayName: customer.displayName, phone: customer.phone,
          templateKey: eventType === "APPOINTMENT_CONFIRMED" ? "appointment-confirmed-customer" : "appointment-rejected-customer",
          body: eventType === "APPOINTMENT_CONFIRMED" ? `Randevunuz onaylandı. ${serviceName} — ${time} — ${staff.displayName}.` : `Randevu talebiniz onaylanmadı. ${serviceName} — ${time}.`,
          templateParameters: eventType === "APPOINTMENT_CONFIRMED" ? [serviceName, time, staff.displayName] : [serviceName, time] }];
      });
    },
    async claim(tenantContext, input) {
      try {
        return await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
          const existing = await tx.notificationDelivery.findUnique({ where: { tenantId_appointmentId_eventType_channel_recipientProfileId: {
            tenantId: tenantContext.tenantId, appointmentId: input.appointmentId, eventType: input.eventType, channel: input.channel, recipientProfileId: input.recipientProfileId,
          } }});
          if (existing?.status === "SENT" || existing?.status === "DELIVERED") return "already_sent";
          if (existing?.status === "PENDING") return "already_pending";
          if (!existing) {
            await tx.notificationDelivery.create({ data: {
              tenantId: tenantContext.tenantId, appointmentId: input.appointmentId, eventType: input.eventType, channel: input.channel,
              recipientProfileId: input.recipientProfileId, templateKey: input.templateKey, status: "PENDING", attemptCount: 0,
            }});
          } else {
            await tx.notificationDelivery.updateMany({ where: { tenantId: tenantContext.tenantId, appointmentId: input.appointmentId, eventType: input.eventType, channel: input.channel, recipientProfileId: input.recipientProfileId }, data: { status: "PENDING" } });
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
        await tx.notificationDelivery.updateMany({ where: { tenantId: tenantContext.tenantId, appointmentId: input.appointmentId, eventType: input.eventType, channel: input.channel, recipientProfileId: input.recipientProfileId }, data: { status: "SENT", providerMessageId: input.providerMessageId, attemptCount: { increment: 1 }, lastErrorCode: null } });
      });
    },
    async markFailed(tenantContext, input) {
      await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        await tx.notificationDelivery.updateMany({ where: { tenantId: tenantContext.tenantId, appointmentId: input.appointmentId, eventType: input.eventType, channel: input.channel, recipientProfileId: input.recipientProfileId }, data: { status: "FAILED", attemptCount: { increment: 1 }, lastErrorCode: input.errorCode } });
      });
    },
  };
}
