import type { PlatformTenantRepository } from "../application/platform-tenant-status";
import { isTenantStatus, type TenantStatus } from "../domain/tenant";

/**
 * WP-07: platform-scope Tenant access (same scope as tenant provisioning).
 * "Tenant" is the root table and is not under RLS; callers must already be SUPER_ADMIN.
 */
export interface PrismaPlatformTenantClient {
  tenant: {
    findMany(args: {
      where: { deletedAt: null };
      select: { id: true; slug: true; name: true; status: true };
      orderBy: { name: "asc" };
    }): Promise<Array<{ id: string; slug: string; name: string; status: string }>>;
    findFirst(args: {
      where: { id: string; deletedAt: null };
      select: { slug: true; status: true };
    }): Promise<{ slug: string; status: string } | null>;
    updateMany(args: {
      where: { id: string; deletedAt: null; status?: "INACTIVE"; slug?: string };
      data: { status: TenantStatus } | { deletedAt: Date };
    }): Promise<{ count: number }>;
  };
}

export function createPrismaPlatformTenantRepository(prisma: PrismaPlatformTenantClient): PlatformTenantRepository {
  return {
    async list() {
      const tenants = await prisma.tenant.findMany({
        where: { deletedAt: null },
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
        // deletedAt: null — an archived tenant can never be reactivated.
        const result = await prisma.tenant.updateMany({ where: { id: tenantId, deletedAt: null }, data: { status } });
        return result.count === 1 ? "updated" : "not_found";
      } catch {
        return "persistence_failure";
      }
    },

    async archive(tenantId, confirmSlug, at) {
      const read = () =>
        prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { slug: true, status: true } });
      const tenant = await read();
      if (tenant === null) return "not_found";
      if (tenant.status === "ACTIVE") return "active";
      if (tenant.slug !== confirmSlug) return "slug_mismatch";
      // Conditional write: a concurrent reactivation, archive or slug change makes this match 0 rows;
      // the slug is verified in the write itself.
      const result = await prisma.tenant.updateMany({
        where: { id: tenantId, deletedAt: null, status: "INACTIVE", slug: confirmSlug },
        data: { deletedAt: at },
      });
      if (result.count === 1) return "archived";
      const after = await read();
      if (after === null) return "not_found";
      if (after.status === "ACTIVE") return "active";
      if (after.slug !== confirmSlug) return "slug_mismatch";
      return "not_found";
    },
  };
}
