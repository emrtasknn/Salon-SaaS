import { appointmentServiceLabel } from "../domain/multi-service";
import type { CustomerAppointmentCancelTx, CustomerAppointmentStatusRepository } from "../application/customer-appointment-status";
import { whatsAppStateOf } from "../domain/appointment-contact";
import type { AppointmentStatus } from "../domain/appointment";
import type { TenantContext } from "../domain/tenant-context";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type AppointmentRow = { id: string; status: AppointmentStatus; startAt: Date; endAt: Date; serviceId: string; staffId: string };

type Tx = PrismaTenantTransactionClient & {
  appointmentAccessToken: {
    findFirst(args: {
      where: { tenantId: string; tokenHash: string; revokedAt: null; expiresAt: { gt: Date } };
      select: { appointmentId: true };
    }): Promise<{ appointmentId: string } | null>;
  };
  appointment: {
    findUnique(args: {
      where: { tenantId_id: { tenantId: string; id: string } };
      select: { id: true; status: true; startAt: true; endAt: true; serviceId: true; staffId: true };
    }): Promise<AppointmentRow | null>;
    updateMany(args: { where: { tenantId: string; id: string; status: AppointmentStatus }; data: { status: AppointmentStatus } }): Promise<{ count: number }>;
  };
  service: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } }; select: { name: true } }): Promise<{ name: string } | null>;
  };
  appointmentService: {
    findMany(args: {
      where: { tenantId: string; appointmentId: string }; orderBy: { position: "asc" }; select: { service: { select: { name: true } } };
    }): Promise<Array<{ service: { name: string } }>>;
  };
  staff: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } }; select: { profileId: true } }): Promise<{ profileId: string } | null>;
  };
  profile: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } }; select: { displayName: true } }): Promise<{ displayName: string } | null>;
  };
  appointmentContact: {
    findUnique(args: {
      where: { tenantId_appointmentId: { tenantId: string; appointmentId: string } };
      select: { whatsappOptIn: true; optOutAt: true };
    }): Promise<{ whatsappOptIn: boolean; optOutAt: Date | null } | null>;
    updateMany(args: {
      where: { tenantId: string; appointmentId: string; whatsappOptIn: true; optOutAt: null };
      data: { optOutAt: Date };
    }): Promise<{ count: number }>;
  };
};


const appointmentSelect = { id: true, status: true, startAt: true, endAt: true, serviceId: true, staffId: true } as const;

// Every query is filtered by the slug-resolved tenantId and runs under RLS (app.tenant_id GUC).
async function findTokenAppointment(tx: Tx, tenantId: string, tokenHash: string, now: Date): Promise<AppointmentRow | null> {
  const token = await tx.appointmentAccessToken.findFirst({
    where: { tenantId, tokenHash, revokedAt: null, expiresAt: { gt: now } },
    select: { appointmentId: true },
  });
  if (!token) return null;
  return tx.appointment.findUnique({ where: { tenantId_id: { tenantId, id: token.appointmentId } }, select: appointmentSelect });
}

export function createPrismaAppointmentAccessTokenRepository(prisma: PrismaTenantClient): CustomerAppointmentStatusRepository {
  return {
    async findDetailsByTokenHash(tenantContext: TenantContext, tokenHash: string, now: Date) {
      const tenantId = tenantContext.tenantId;
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const appointment = await findTokenAppointment(tx, tenantId, tokenHash, now);
        if (!appointment) return null;
        const [service, staff, contact] = await Promise.all([
          tx.service.findUnique({ where: { tenantId_id: { tenantId, id: appointment.serviceId } }, select: { name: true } }),
          tx.staff.findUnique({ where: { tenantId_id: { tenantId, id: appointment.staffId } }, select: { profileId: true } }),
          tx.appointmentContact.findUnique({
            where: { tenantId_appointmentId: { tenantId, appointmentId: appointment.id } },
            select: { whatsappOptIn: true, optOutAt: true },
          }),
        ]);
        const profile = staff
          ? await tx.profile.findUnique({ where: { tenantId_id: { tenantId, id: staff.profileId } }, select: { displayName: true } })
          : null;
        if (!service || !profile) return null;
        // Multi-service (owner decision 2026-11-06): the customer sees every booked service.
        const services = await tx.appointmentService.findMany({
          where: { tenantId, appointmentId: appointment.id }, orderBy: { position: "asc" }, select: { service: { select: { name: true } } },
        });
        return {
          appointmentId: appointment.id, status: appointment.status, startAt: appointment.startAt, endAt: appointment.endAt,
          serviceName: appointmentServiceLabel(service.name, services.map((item) => item.service.name)), staffName: profile.displayName, whatsapp: whatsAppStateOf(contact),
        };
      });
    },

    async stopWhatsAppByTokenHash(tenantContext, tokenHash, now) {
      const tenantId = tenantContext.tenantId;
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const appointment = await findTokenAppointment(tx, tenantId, tokenHash, now);
        if (!appointment) return "not_found" as const;
        const updated = await tx.appointmentContact.updateMany({
          where: { tenantId, appointmentId: appointment.id, whatsappOptIn: true, optOutAt: null },
          data: { optOutAt: now },
        });
        if (updated.count === 1) return "stopped" as const;
        const contact = await tx.appointmentContact.findUnique({
          where: { tenantId_appointmentId: { tenantId, appointmentId: appointment.id } },
          select: { whatsappOptIn: true, optOutAt: true },
        });
        return whatsAppStateOf(contact) === "OPTED_OUT" ? "already_stopped" as const : "not_opted_in" as const;
      });
    },

    async inCancelTransaction(tenantContext, operation) {
      const tenantId = tenantContext.tenantId;
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const ops: CustomerAppointmentCancelTx = {
          async findByTokenHash(tokenHash, now) {
            const appointment = await findTokenAppointment(tx, tenantId, tokenHash, now);
            return appointment ? { appointmentId: appointment.id, status: appointment.status, startAt: appointment.startAt } : null;
          },
          async readAppointment(appointmentId) {
            const appointment = await tx.appointment.findUnique({ where: { tenantId_id: { tenantId, id: appointmentId } }, select: appointmentSelect });
            return appointment ? { status: appointment.status, startAt: appointment.startAt } : null;
          },
          async updateStatus(appointmentId, from, to) {
            const result = await tx.appointment.updateMany({ where: { tenantId, id: appointmentId, status: from }, data: { status: to } });
            return result.count === 1;
          },
        };
        return operation(ops);
      });
    },
  };
}
