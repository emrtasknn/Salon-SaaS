import type { PublicBookingRepository } from "../application/public-booking";
import type { TenantContext } from "../domain/tenant-context";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  service: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<{ id: string; durationMinutes: number; bufferMinutes: number; active: boolean } | null> };
  staff: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<{ id: string; status: "ACTIVE" | "INACTIVE" } | null> };
  profile: {
    findUnique(args: { where: { tenantId_email: { tenantId: string; email: string } } }): Promise<{ id: string } | null>;
    create(args: { data: { tenantId: string; displayName: string; email: string; phone: string | null } }): Promise<{ id: string }>;
  };
  appointment: {
    findMany(args: { where: { tenantId: string; staffId: string; startAt: { lt: Date }; endAt: { gt: Date } } }): Promise<Array<{ status: "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED" }>>;
    create(args: { data: { tenantId: string; staffId: string; serviceId: string; customerProfileId: string; startAt: Date; endAt: Date; status: "PENDING" } }): Promise<{ id: string }>;
  };
};

export function createPrismaPublicBookingRepository(prisma: PrismaTenantClient): PublicBookingRepository {
  return {
    async create(tenantContext, input) {
      try {
        return await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantContext.tenantId + ":" + input.staffId + ":" + input.startAt.toISOString()}, 0))`;
          const [service, staff] = await Promise.all([
            tx.service.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.serviceId } } }),
            tx.staff.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.staffId } } }),
          ]);
          if (!service || !staff || !service.active || staff.status !== "ACTIVE") return "invalid_resource";
          const endAt = new Date(input.startAt.getTime() + (service.durationMinutes + service.bufferMinutes) * 60_000);
          const conflicts = await tx.appointment.findMany({ where: {
            tenantId: tenantContext.tenantId, staffId: input.staffId, startAt: { lt: endAt }, endAt: { gt: input.startAt },
          }});
          if (conflicts.some((a) => a.status !== "CANCELLED" && a.status !== "REJECTED")) return "slot_unavailable";
          let profile = await tx.profile.findUnique({ where: { tenantId_email: { tenantId: tenantContext.tenantId, email: input.email } } });
          if (!profile) profile = await tx.profile.create({ data: { tenantId: tenantContext.tenantId, displayName: input.displayName, email: input.email, phone: input.phone } });
          await tx.appointment.create({ data: { tenantId: tenantContext.tenantId, staffId: input.staffId, serviceId: input.serviceId, customerProfileId: profile.id, startAt: input.startAt, endAt, status: "PENDING" } });
          return "created";
        });
      } catch { return "persistence_failure"; }
    },
  };
}
