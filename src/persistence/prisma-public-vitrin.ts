import type { PublicSalonRepository } from "../application/public-vitrin";
import type { TenantContext } from "../domain/tenant-context";
import type { ServiceRecord } from "../domain/service";
import type { WorkingHoursRecord } from "../domain/working-hours";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  tenant: { findUnique(args: { where: { slug: string } }): Promise<{ id: string; name: string; timezone: string } | null> };
  service: { findMany(args: { where: { tenantId: string; active: boolean }; orderBy: { name: "asc" } }): Promise<ServiceRecord[]> };
  staff: { findMany(args: { where: { tenantId: string; status: "ACTIVE" }; orderBy: { id: "asc" } }): Promise<Array<{ id: string; profileId: string; status: "ACTIVE" }>> };
  profile: { findMany(args: { where: { tenantId: string; id: { in: string[] } } }): Promise<Array<{ id: string; displayName: string }>> };
  workingHours: { findMany(args: { where: { tenantId: string }; orderBy: { dayOfWeek: "asc" } }): Promise<WorkingHoursRecord[]> };
};

export function createPrismaPublicSalonRepository(prisma: PrismaTenantClient): PublicSalonRepository {
  return {
    async resolveBySlug(slug) {
      const tenant = await prisma.$transaction(async (tx) => tx.tenant.findUnique({ where: { slug } }));
      if (!tenant) return null;
      return { tenantContext: { tenantId: tenant.id as never }, name: tenant.name, timezone: tenant.timezone };
    },
    async catalog(tenantContext: TenantContext) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const [services, staff, workingHours] = await Promise.all([
          tx.service.findMany({ where: { tenantId: tenantContext.tenantId, active: true }, orderBy: { name: "asc" } }),
          tx.staff.findMany({ where: { tenantId: tenantContext.tenantId, status: "ACTIVE" }, orderBy: { id: "asc" } }),
          tx.workingHours.findMany({ where: { tenantId: tenantContext.tenantId }, orderBy: { dayOfWeek: "asc" } }),
        ]);
        const profiles = await tx.profile.findMany({ where: { tenantId: tenantContext.tenantId, id: { in: staff.map((s) => s.profileId) } } });
        const names = new Map(profiles.map((p) => [p.id, p.displayName]));
        return {
          services,
          staff: staff.map((s) => ({ ...s, displayName: names.get(s.profileId) ?? "Staff" })),
          workingHours,
        };
      });
    },
  };
}
