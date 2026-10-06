import type { StaffAppointmentsRepository } from "../application/staff-appointments";
import type { AppointmentRecord } from "../domain/appointment";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  appointment: {
    findMany(args: { where: Record<string, unknown>; orderBy: Record<string, unknown> }): Promise<AppointmentRecord[]>;
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<AppointmentRecord | null>;
  };
  staff: {
    findUnique(args: { where: { tenantId_profileId: { tenantId: string; profileId: string } } }): Promise<{ id: string; tenantId: string; profileId: string; status: "ACTIVE" | "INACTIVE" } | null>;
  };
};

export function createPrismaStaffAppointmentsRepository(prisma: PrismaTenantClient): StaffAppointmentsRepository {
  return {
    async listForStaff(tenantContext, staffId, range) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
        tx.appointment.findMany({
          where: {
            tenantId: tenantContext.tenantId,
            staffId,
            startAt: { lt: range.endAt },
            endAt: { gt: range.startAt },
          },
          orderBy: { startAt: "asc" },
        }),
      );
    },
    async findById(tenantContext, appointmentId) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
        tx.appointment.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: appointmentId } } }),
      );
    },
  };
}
