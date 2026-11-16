import type { ServiceDeletionRepository } from "../application/service-deletion";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: readonly unknown[]): Promise<T>;
  service: {
    findFirst(args: { where: { tenantId: string; id: string; deletedAt: null } }): Promise<{ id: string } | null>;
    update(args: { where: { tenantId_id: { tenantId: string; id: string } }; data: { deletedAt: Date; active: false } }): Promise<unknown>;
  };
  appointment: {
    count(args: {
      where: {
        tenantId: string;
        status: { in: Array<"PENDING" | "CONFIRMED"> };
        startAt: { gt: Date };
        deletedAt: null;
        OR: Array<{ serviceId: string } | { services: { some: { tenantId: string; serviceId: string } } }>;
      };
    }): Promise<number>;
  };
  staffService: { deleteMany(args: { where: { tenantId: string; serviceId: string } }): Promise<unknown> };
};

// Archive (soft delete): the service row stays so past appointments keep their service name.
export function createPrismaServiceDeletionRepository(prisma: PrismaTenantClient): ServiceDeletionRepository {
  return {
    async archive(tenantContext, { serviceId, now }) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const tenantId = tenantContext.tenantId;
        // FOR NO KEY UPDATE conflicts with bookings' Tenant FOR SHARE: in-flight bookings finish first,
        // so the active-appointment count below cannot miss a concurrent booking.
        await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR NO KEY UPDATE`;

        const service = await tx.service.findFirst({ where: { tenantId, id: serviceId, deletedAt: null } });
        if (!service) return "not_found" as const;

        // One count over Appointment: an appointment matched by both paths is counted once.
        const count = await tx.appointment.count({
          where: {
            tenantId,
            status: { in: ["PENDING", "CONFIRMED"] },
            startAt: { gt: now },
            deletedAt: null,
            OR: [{ serviceId }, { services: { some: { tenantId, serviceId } } }],
          },
        });
        if (count > 0) return { status: "has_active_appointments" as const, count };

        await tx.service.update({ where: { tenantId_id: { tenantId, id: serviceId } }, data: { deletedAt: now, active: false } });
        await tx.staffService.deleteMany({ where: { tenantId, serviceId } });
        return "archived" as const;
      });
    },
  };
}
