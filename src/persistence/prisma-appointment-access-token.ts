import type { CustomerAppointmentCancelTx, CustomerAppointmentStatusRepository } from "../application/customer-appointment-status";
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
  staff: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } }; select: { profileId: true } }): Promise<{ profileId: string } | null>;
  };
  profile: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } }; select: { displayName: true } }): Promise<{ displayName: string } | null>;
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
        const [service, staff] = await Promise.all([
          tx.service.findUnique({ where: { tenantId_id: { tenantId, id: appointment.serviceId } }, select: { name: true } }),
          tx.staff.findUnique({ where: { tenantId_id: { tenantId, id: appointment.staffId } }, select: { profileId: true } }),
        ]);
        const profile = staff
          ? await tx.profile.findUnique({ where: { tenantId_id: { tenantId, id: staff.profileId } }, select: { displayName: true } })
          : null;
        if (!service || !profile) return null;
        return {
          appointmentId: appointment.id, status: appointment.status, startAt: appointment.startAt, endAt: appointment.endAt,
          serviceName: service.name, staffName: profile.displayName,
        };
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
