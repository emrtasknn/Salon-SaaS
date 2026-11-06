import type { ServiceRepository } from "../application/service-management";
import type { ServiceRecord } from "../domain/service";
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
      where: { tenantId: string; id: string };
      data: { active: boolean };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { tenantId_id: { tenantId: string; id: string } };
    }): Promise<ServiceRow | null>;
    findMany(args: {
      where: { tenantId: string };
      orderBy: { name: "asc" };
    }): Promise<ServiceRow[]>;
  };
};

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
        await withPrismaTenantContext(
          prisma,
          tenantContext,
          async (tx: PrismaServiceTransaction) => {
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
          },
        );
        return "created";
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
              },
            });
            if (!existing) return "not_found" as const;

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
            where: { tenantId: tenantContext.tenantId },
            orderBy: { name: "asc" },
          }),
      );
      return rows.map(toService);
    },
  };
}
