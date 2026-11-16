import type { ServiceRepository } from "../application/service-management";
import {
  archivedServiceNameCandidates,
  chooseArchivedServiceName,
  type ServiceRecord,
} from "../domain/service";
import {
  withPrismaTenantContext,
  type PrismaTenantClient,
  type PrismaTenantTransactionClient,
} from "./prisma-tenant-context";

type ServiceRow = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  active: boolean;
  categoryId?: string | null;
  priceMinor?: number | null;
  priceIsFrom?: boolean;
}>;

type CatalogData = { categoryId?: string | null; priceMinor?: number | null; priceIsFrom?: boolean };

export type PrismaServiceTransaction = PrismaTenantTransactionClient & {
  service: {
    create(args: {
      data: {
        tenantId: string;
        name: string;
        durationMinutes: number;
        bufferMinutes: number;
        active: boolean;
      } & CatalogData;
    }): Promise<ServiceRow>;
    update(args: {
      where: { tenantId_id: { tenantId: string; id: string } };
      data: {
        name?: string;
        durationMinutes?: number;
        bufferMinutes?: number;
      } & CatalogData;
    }): Promise<ServiceRow>;
    updateMany(args: {
      where: { tenantId: string; id: string; deletedAt: null };
      data: { active: boolean };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { tenantId_id: { tenantId: string; id: string }; deletedAt: null };
    }): Promise<ServiceRow | null>;
    findMany(args: {
      where: { tenantId: string; deletedAt: null };
      orderBy: { name: "asc" };
    }): Promise<ServiceRow[]>;
    findMany(args: {
      where: { tenantId: string; name: { in: string[] } };
      select: { name: true };
    }): Promise<Array<{ name: string }>>;
    findFirst(args: {
      where: { tenantId: string; name: string };
      select: { id: true; deletedAt: true };
    }): Promise<{ id: string; deletedAt: Date | null } | null>;
  };
};

/**
 * Frees `name` for reuse when an ARCHIVED service of this tenant holds it, by
 * renaming that row in the caller's transaction (before the create/update, so no
 * P2002 aborts the transaction). Returns "conflict" when a live service (other
 * than `selfId`) holds the name or no archived name is free.
 */
async function freeArchivedServiceName(
  tx: PrismaServiceTransaction,
  tenantId: string,
  name: string,
  selfId?: string,
): Promise<"free" | "conflict"> {
  const holder = await tx.service.findFirst({
    where: { tenantId, name },
    select: { id: true, deletedAt: true },
  });
  if (!holder || holder.id === selfId) return "free";
  if (holder.deletedAt === null) return "conflict";

  const taken = await tx.service.findMany({
    where: { tenantId, name: { in: archivedServiceNameCandidates(name) } },
    select: { name: true },
  });
  const newName = chooseArchivedServiceName(name, new Set(taken.map((row) => row.name)));
  if (newName === null) return "conflict";

  await tx.service.update({
    where: { tenantId_id: { tenantId, id: holder.id } },
    data: { name: newName },
  });
  return "free";
}

export type PrismaServiceClient = PrismaTenantClient;

function toService(row: ServiceRow): ServiceRecord {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    durationMinutes: row.durationMinutes,
    bufferMinutes: row.bufferMinutes,
    active: row.active,
    categoryId: row.categoryId ?? null,
    priceMinor: row.priceMinor ?? null,
    priceIsFrom: row.priceIsFrom ?? false,
  });
}

/** FK violation: the category does not exist in THIS tenant (composite FK). */
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2003";
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export function createPrismaServiceRepository(
  prisma: PrismaServiceClient,
): ServiceRepository {
  return {
    async create(tenantContext, input) {
      try {
        return await withPrismaTenantContext(
          prisma,
          tenantContext,
          async (tx: PrismaServiceTransaction) => {
            const freed = await freeArchivedServiceName(tx, tenantContext.tenantId, input.name);
            if (freed === "conflict") return "conflict" as const;
            await tx.service.create({
              data: {
                tenantId: tenantContext.tenantId,
                name: input.name,
                durationMinutes: input.durationMinutes,
                bufferMinutes: input.bufferMinutes,
                active: true,
                ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
                ...(input.priceMinor !== undefined ? { priceMinor: input.priceMinor } : {}),
                ...(input.priceIsFrom !== undefined ? { priceIsFrom: input.priceIsFrom } : {}),
              },
            });
            return "created" as const;
          },
        );
      } catch (error) {
        if (isUniqueConflict(error)) return "conflict";
        if (isForeignKeyViolation(error)) return "category_not_found";
        throw error;
      }
    },

    async update(tenantContext, serviceId, patch) {
      try {
        return await withPrismaTenantContext(
          prisma,
          tenantContext,
          async (tx: PrismaServiceTransaction) => {
            const existing = await tx.service.findUnique({
              where: {
                tenantId_id: {
                  tenantId: tenantContext.tenantId,
                  id: serviceId,
                },
                deletedAt: null,
              },
            });
            if (!existing) return "not_found" as const;

            if (patch.name !== undefined) {
              const freed = await freeArchivedServiceName(tx, tenantContext.tenantId, patch.name, serviceId);
              if (freed === "conflict") return "conflict" as const;
            }

            await tx.service.update({
              where: {
                tenantId_id: {
                  tenantId: tenantContext.tenantId,
                  id: serviceId,
                },
              },
              data: patch,
            });
            return "updated" as const;
          },
        );
      } catch (error) {
        if (isUniqueConflict(error)) return "conflict";
        if (isForeignKeyViolation(error)) return "category_not_found";
        throw error;
      }
    },

    async setActive(tenantContext, serviceId, active) {
      const result = await withPrismaTenantContext(
        prisma,
        tenantContext,
        async (tx: PrismaServiceTransaction) =>
          tx.service.updateMany({
            where: {
              tenantId: tenantContext.tenantId,
              id: serviceId,
              deletedAt: null,
            },
            data: { active },
          }),
      );
      return result.count === 1 ? "updated" : "not_found";
    },

    async list(tenantContext) {
      const rows = await withPrismaTenantContext(
        prisma,
        tenantContext,
        async (tx: PrismaServiceTransaction) =>
          tx.service.findMany({
            where: { tenantId: tenantContext.tenantId, deletedAt: null },
            orderBy: { name: "asc" },
          }),
      );
      return rows.map(toService);
    },
  };
}
