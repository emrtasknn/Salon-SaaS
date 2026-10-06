import type { WorkingHoursRecord } from "../domain/working-hours";
import type { WorkingHoursRepository } from "../application/working-hours-management";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type WorkingHoursRow = Readonly<{ id: string; tenantId: string; dayOfWeek: number; openMinute: number; closeMinute: number }>;

type WorkingHoursTransaction = PrismaTenantTransactionClient & {
  workingHours: {
    findUnique(args: { where: { tenantId_dayOfWeek: { tenantId: string; dayOfWeek: number } } }): Promise<WorkingHoursRow | null>;
    upsert(args: {
      where: { tenantId_dayOfWeek: { tenantId: string; dayOfWeek: number } };
      create: { tenantId: string; dayOfWeek: number; openMinute: number; closeMinute: number };
      update: { openMinute: number; closeMinute: number };
    }): Promise<WorkingHoursRow>;
    deleteMany(args: { where: { tenantId: string; dayOfWeek: number } }): Promise<{ count: number }>;
    findMany(args: { where: { tenantId: string }; orderBy: { dayOfWeek: "asc" } }): Promise<WorkingHoursRow[]>;
  };
};

export function createPrismaWorkingHoursRepository(prisma: PrismaTenantClient): WorkingHoursRepository {
  return {
    async upsert(tenantContext, input) {
      try {
        return await withPrismaTenantContext(prisma, tenantContext, async (tx: WorkingHoursTransaction) => {
          const existing = await tx.workingHours.findUnique({ where: { tenantId_dayOfWeek: { tenantId: tenantContext.tenantId, dayOfWeek: input.dayOfWeek } } });
          await tx.workingHours.upsert({
            where: { tenantId_dayOfWeek: { tenantId: tenantContext.tenantId, dayOfWeek: input.dayOfWeek } },
            create: { tenantId: tenantContext.tenantId, ...input },
            update: { openMinute: input.openMinute, closeMinute: input.closeMinute },
          });
          return existing ? "updated" as const : "created" as const;
        });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return "conflict";
        throw error;
      }
    },
    async remove(tenantContext, dayOfWeek) {
      const result = await withPrismaTenantContext(prisma, tenantContext, async (tx: WorkingHoursTransaction) =>
        tx.workingHours.deleteMany({ where: { tenantId: tenantContext.tenantId, dayOfWeek } }),
      );
      return result.count === 1 ? "removed" : "not_found";
    },
    async list(tenantContext) {
      const rows = await withPrismaTenantContext(prisma, tenantContext, async (tx: WorkingHoursTransaction) =>
        tx.workingHours.findMany({ where: { tenantId: tenantContext.tenantId }, orderBy: { dayOfWeek: "asc" } }),
      );
      return rows.map((row): WorkingHoursRecord => Object.freeze({ ...row }));
    },
  };
}
