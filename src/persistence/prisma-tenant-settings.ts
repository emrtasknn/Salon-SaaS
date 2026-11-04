import type { TenantSettingsRepository } from "../application/tenant-settings";
import type { TenantContext } from "../domain/tenant-context";
import { isTenantStatus } from "../domain/tenant";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  tenant: {
    findUnique(args: {
      where: { id: string };
      select: { name: true; contactPhone: true; status: true; timezone: true };
    }): Promise<{ name: string; contactPhone: string | null; status: string; timezone: string } | null>;
    updateMany(args: {
      where: { id: string };
      data: { name: string; contactPhone: string | null };
    }): Promise<{ count: number }>;
  };
};

/** WP-07: tenant id always comes from the trusted TenantContext, never from input. */
export function createPrismaTenantSettingsRepository(prisma: PrismaTenantClient): TenantSettingsRepository {
  return {
    async read(tenantContext: TenantContext) {
      const tenant = await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
        tx.tenant.findUnique({
          where: { id: tenantContext.tenantId },
          select: { name: true, contactPhone: true, status: true, timezone: true },
        }),
      );
      if (!tenant || !isTenantStatus(tenant.status)) return null;
      return { name: tenant.name, contactPhone: tenant.contactPhone ?? null, status: tenant.status, timezone: tenant.timezone };
    },

    async update(tenantContext: TenantContext, input) {
      try {
        const result = await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
          tx.tenant.updateMany({
            where: { id: tenantContext.tenantId },
            data: { name: input.name, contactPhone: input.contactPhone },
          }),
        );
        return result.count === 1 ? "updated" : "not_found";
      } catch {
        return "persistence_failure";
      }
    },
  };
}
