import type { PublicAvailabilityRepository } from "../application/public-availability";
import type { TenantContext } from "../domain/tenant-context";
import type { WorkingHoursRecord } from "../domain/working-hours";
import type { AppointmentRecord } from "../domain/appointment";
import { localWallTimeToUtc } from "../domain/availability";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  tenant: { findUnique(args: { where: { id: string } }): Promise<{ id: string; timezone: string } | null> };
  service: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<{ id: string; durationMinutes: number; bufferMinutes: number; active: boolean } | null> };
  staff: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<{ id: string; status: "ACTIVE" | "INACTIVE" } | null> };
  workingHours: { findMany(args: { where: { tenantId: string }; orderBy: { dayOfWeek: "asc" } }): Promise<WorkingHoursRecord[]> };
  appointment: { findMany(args: { where: { tenantId: string; staffId: string; startAt: { lt: Date }; endAt: { gt: Date } } }): Promise<AppointmentRecord[]> };
};

export function createPrismaPublicAvailabilityRepository(prisma: PrismaTenantClient): PublicAvailabilityRepository {
  return {
    async read(tenantContext: TenantContext, input) {
      try {
        return await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
          const [tenant, service, staff, workingHours] = await Promise.all([
            tx.tenant.findUnique({ where: { id: tenantContext.tenantId } }),
            tx.service.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.serviceId } } }),
            tx.staff.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.staffId } } }),
            tx.workingHours.findMany({ where: { tenantId: tenantContext.tenantId }, orderBy: { dayOfWeek: "asc" } }),
          ]);
          if (!tenant || !service || !staff) return { status: "invalid_resource" as const };

          const dayStart = localWallTimeToUtc(input.dateIso, 0, tenant.timezone);
          const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60_000);
          const appointments = await tx.appointment.findMany({
            where: {
              tenantId: tenantContext.tenantId,
              staffId: input.staffId,
              startAt: { lt: nextDay },
              endAt: { gt: dayStart },
            },
          });

          return {
            status: "ok" as const,
            timeZone: tenant.timezone,
            durationMinutes: service.durationMinutes,
            bufferMinutes: service.bufferMinutes,
            workingHours,
            appointments,
            serviceActive: service.active,
            staffActive: staff.status === "ACTIVE",
          };
        });
      } catch {
        return { status: "invalid_resource" as const };
      }
    },
  };
}
