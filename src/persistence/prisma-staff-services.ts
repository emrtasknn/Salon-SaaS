import type { StaffServiceRepository } from "../application/staff-services";
import { staffPerformsService } from "../domain/staff-service";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type Row = Readonly<{ staffId: string; serviceId: string }>;

export type StaffServiceReadTransaction = {
  staffService: {
    findMany(args: { where: { tenantId: string; staffId?: string }; select: { staffId: true; serviceId: true } }): Promise<Row[]>;
  };
};

type Tx = PrismaTenantTransactionClient & StaffServiceReadTransaction & {
  staff: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<{ id: string } | null> };
  service: { findMany(args: { where: { tenantId: string; id: { in: string[] } }; select: { id: true } }): Promise<Array<{ id: string }>> };
  staffService: StaffServiceReadTransaction["staffService"] & {
    deleteMany(args: { where: { tenantId: string; staffId: string } }): Promise<{ count: number }>;
    createMany(args: { data: Array<{ tenantId: string; staffId: string; serviceId: string }> }): Promise<{ count: number }>;
  };
};

/**
 * In-transaction check used by public availability and the public booking transaction:
 * a staff member with no mapping rows performs every service.
 */
export async function staffServesService(tx: StaffServiceReadTransaction, tenantId: string, staffId: string, serviceId: string) {
  const rows = await tx.staffService.findMany({ where: { tenantId, staffId }, select: { staffId: true, serviceId: true } });
  return staffPerformsService(rows.map((row) => row.serviceId), serviceId);
}

/** staffId -> mapped service ids (staff without rows are absent = every service). */
export async function readStaffServiceMap(tx: StaffServiceReadTransaction, tenantId: string): Promise<Map<string, string[]>> {
  const rows = await tx.staffService.findMany({ where: { tenantId }, select: { staffId: true, serviceId: true } });
  const map = new Map<string, string[]>();
  for (const row of rows) map.set(row.staffId, [...(map.get(row.staffId) ?? []), row.serviceId]);
  return map;
}

/** Every query runs inside withPrismaTenantContext, so RLS scopes it to the tenant as well. */
export function createPrismaStaffServiceRepository(prisma: PrismaTenantClient): StaffServiceRepository {
  return {
    async list(tenantContext) {
      return withPrismaTenantContext(prisma, tenantContext, (tx: Tx) => readStaffServiceMap(tx, tenantContext.tenantId));
    },

    async replace(tenantContext, staffId, serviceIds) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const tenantId = tenantContext.tenantId;
        const staff = await tx.staff.findUnique({ where: { tenantId_id: { tenantId, id: staffId } } });
        if (!staff) return "not_found" as const;
        if (serviceIds.length) {
          const found = await tx.service.findMany({ where: { tenantId, id: { in: [...serviceIds] } }, select: { id: true } });
          if (found.length !== serviceIds.length) return "invalid_service" as const;
        }
        // Replace the whole set in one transaction; an empty set means "every service".
        await tx.staffService.deleteMany({ where: { tenantId, staffId } });
        if (serviceIds.length) {
          await tx.staffService.createMany({ data: serviceIds.map((serviceId) => ({ tenantId, staffId, serviceId })) });
        }
        return "updated" as const;
      });
    },
  };
}
