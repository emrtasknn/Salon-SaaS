import type { PlatformTenantRepository } from "../application/platform-tenant-status";
import { isTenantStatus, type TenantStatus } from "../domain/tenant";

/**
 * WP-07: platform-scope Tenant access (same scope as tenant provisioning).
 * "Tenant" is the root table and is not under RLS; callers must already be SUPER_ADMIN.
 */
export interface PrismaPlatformTenantClient {
  tenant: {
    findMany(args: {
      select: { id: true; slug: true; name: true; status: true };
      orderBy: { name: "asc" };
    }): Promise<Array<{ id: string; slug: string; name: string; status: string }>>;
    updateMany(args: { where: { id: string }; data: { status: TenantStatus } }): Promise<{ count: number }>;
  };
}

export function createPrismaPlatformTenantRepository(prisma: PrismaPlatformTenantClient): PlatformTenantRepository {
  return {
    async list() {
      const tenants = await prisma.tenant.findMany({
        select: { id: true, slug: true, name: true, status: true },
        orderBy: { name: "asc" },
      });
      return tenants.map((tenant) => ({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        // Fail closed: an unknown DB value is shown as INACTIVE.
        status: isTenantStatus(tenant.status) ? tenant.status : "INACTIVE",
      }));
    },

    async setStatus(tenantId, status) {
      try {
        const result = await prisma.tenant.updateMany({ where: { id: tenantId }, data: { status } });
        return result.count === 1 ? "updated" : "not_found";
      } catch {
        return "persistence_failure";
      }
    },
  };
}
