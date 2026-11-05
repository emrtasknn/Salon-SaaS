import type { TenantSettingsRepository } from "../application/tenant-settings";
import type { TenantContext } from "../domain/tenant-context";
import { isTenantStatus } from "../domain/tenant";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  tenant: {
    findUnique(args: {
      where: { id: string };
      select: {
        name: true; contactPhone: true; status: true; timezone: true; legalName: true; legalAddress: true; kvkkContactEmail: true;
        publicAddress: true; mapsUrl: true;
      };
    }): Promise<{
      name: string; contactPhone: string | null; status: string; timezone: string;
      legalName: string | null; legalAddress: string | null; kvkkContactEmail: string | null;
      publicAddress: string | null; mapsUrl: string | null;
    } | null>;
    updateMany(args: {
      where: { id: string };
      data: {
        name: string; contactPhone: string | null; legalName?: string | null; legalAddress?: string | null; kvkkContactEmail?: string | null;
        publicAddress?: string | null; mapsUrl?: string | null;
      };
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
          select: {
            name: true, contactPhone: true, status: true, timezone: true, legalName: true, legalAddress: true, kvkkContactEmail: true,
            publicAddress: true, mapsUrl: true,
          },
        }),
      );
      if (!tenant || !isTenantStatus(tenant.status)) return null;
      return {
        name: tenant.name, contactPhone: tenant.contactPhone ?? null, status: tenant.status, timezone: tenant.timezone,
        legal: { legalName: tenant.legalName ?? null, legalAddress: tenant.legalAddress ?? null, kvkkContactEmail: tenant.kvkkContactEmail ?? null },
        location: { publicAddress: tenant.publicAddress ?? null, mapsUrl: tenant.mapsUrl ?? null },
      };
    },

    async update(tenantContext: TenantContext, input) {
      try {
        const result = await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
          tx.tenant.updateMany({
            where: { id: tenantContext.tenantId },
            data: {
              name: input.name, contactPhone: input.contactPhone,
              // WP-10: only keys present in the input are written (absent = unchanged).
              ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
              ...(input.legalAddress !== undefined ? { legalAddress: input.legalAddress } : {}),
              ...(input.kvkkContactEmail !== undefined ? { kvkkContactEmail: input.kvkkContactEmail } : {}),
              ...(input.publicAddress !== undefined ? { publicAddress: input.publicAddress } : {}),
              ...(input.mapsUrl !== undefined ? { mapsUrl: input.mapsUrl } : {}),
            },
          }),
        );
        return result.count === 1 ? "updated" : "not_found";
      } catch {
        return "persistence_failure";
      }
    },
  };
}
