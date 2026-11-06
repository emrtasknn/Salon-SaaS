import type { ServiceCategoryRepository } from "../application/service-categories";
import { SERVICE_CATEGORY_SORT_MAX, type ServiceCategoryRecord } from "../domain/service-category";
import {
  withPrismaTenantContext,
  type PrismaTenantClient,
  type PrismaTenantTransactionClient,
} from "./prisma-tenant-context";

type CategoryRow = Readonly<{ id: string; tenantId: string; name: string; sortOrder: number }>;
type Key = { tenantId_id: { tenantId: string; id: string } };

type Tx = PrismaTenantTransactionClient & {
  serviceCategory: {
    findMany(args: { where: { tenantId: string }; orderBy: Array<{ sortOrder: "asc" } | { name: "asc" }> }): Promise<CategoryRow[]>;
    findUnique(args: { where: Key }): Promise<CategoryRow | null>;
    aggregate(args: { where: { tenantId: string }; _max: { sortOrder: true } }): Promise<{ _max: { sortOrder: number | null } }>;
    create(args: { data: { tenantId: string; name: string; sortOrder: number } }): Promise<CategoryRow>;
    update(args: { where: Key; data: { name?: string; sortOrder?: number } }): Promise<CategoryRow>;
    delete(args: { where: Key }): Promise<CategoryRow>;
  };
  service: {
    updateMany(args: { where: { tenantId: string; categoryId: string }; data: { categoryId: null } }): Promise<{ count: number }>;
  };
};

const toRecord = (row: CategoryRow): ServiceCategoryRecord =>
  Object.freeze({ id: row.id, tenantId: row.tenantId, name: row.name, sortOrder: row.sortOrder });

const isUniqueConflict = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

/** Every query runs inside withPrismaTenantContext, so RLS scopes it to the tenant as well. */
export function createPrismaServiceCategoryRepository(prisma: PrismaTenantClient): ServiceCategoryRepository {
  const run = <T>(tenantContext: Parameters<ServiceCategoryRepository["list"]>[0], operation: (tx: Tx) => Promise<T>) =>
    withPrismaTenantContext(prisma, tenantContext, operation);
  const key = (tenantId: string, id: string): Key => ({ tenantId_id: { tenantId, id } });
  const ordered = (tx: Tx, tenantId: string) =>
    tx.serviceCategory.findMany({ where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });

  return {
    async list(tenantContext) {
      return (await run(tenantContext, (tx) => ordered(tx, tenantContext.tenantId))).map(toRecord);
    },

    async create(tenantContext, name) {
      try {
        await run(tenantContext, async (tx) => {
          const max = await tx.serviceCategory.aggregate({ where: { tenantId: tenantContext.tenantId }, _max: { sortOrder: true } });
          const sortOrder = Math.min((max._max.sortOrder ?? 0) + 1, SERVICE_CATEGORY_SORT_MAX);
          await tx.serviceCategory.create({ data: { tenantId: tenantContext.tenantId, name, sortOrder } });
        });
        return "created";
      } catch (error) {
        if (isUniqueConflict(error)) return "conflict";
        throw error;
      }
    },

    async rename(tenantContext, categoryId, name) {
      try {
        return await run(tenantContext, async (tx) => {
          const existing = await tx.serviceCategory.findUnique({ where: key(tenantContext.tenantId, categoryId) });
          if (!existing) return "not_found" as const;
          await tx.serviceCategory.update({ where: key(tenantContext.tenantId, categoryId), data: { name } });
          return "updated" as const;
        });
      } catch (error) {
        if (isUniqueConflict(error)) return "conflict";
        throw error;
      }
    },

    async move(tenantContext, categoryId, direction) {
      return run(tenantContext, async (tx) => {
        const rows = await ordered(tx, tenantContext.tenantId);
        const index = rows.findIndex((row) => row.id === categoryId);
        if (index === -1) return "not_found" as const;
        const neighbour = direction === "up" ? index - 1 : index + 1;
        if (neighbour < 0 || neighbour >= rows.length) return "updated" as const;
        // Renumber the whole list in its new order, so equal or gapped sortOrder values never stall a move.
        const next = [...rows];
        [next[index], next[neighbour]] = [next[neighbour], next[index]];
        for (const [position, row] of next.entries()) {
          if (row.sortOrder !== position + 1) {
            await tx.serviceCategory.update({ where: key(tenantContext.tenantId, row.id), data: { sortOrder: position + 1 } });
          }
        }
        return "updated" as const;
      });
    },

    async remove(tenantContext, categoryId) {
      return run(tenantContext, async (tx) => {
        const existing = await tx.serviceCategory.findUnique({ where: key(tenantContext.tenantId, categoryId) });
        if (!existing) return "not_found" as const;
        // The composite FK is RESTRICT: detach this tenant's services first, in the same transaction.
        await tx.service.updateMany({ where: { tenantId: tenantContext.tenantId, categoryId }, data: { categoryId: null } });
        await tx.serviceCategory.delete({ where: key(tenantContext.tenantId, categoryId) });
        return "deleted" as const;
      });
    },
  };
}
