import type { PublicSalonRepository } from "../application/public-vitrin";
import type { TenantContext } from "../domain/tenant-context";
import type { ServiceRecord } from "../domain/service";
import type { WorkingHoursRecord } from "../domain/working-hours";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { readStaffServiceMap, type StaffServiceReadTransaction } from "./prisma-staff-services";

type Tx = PrismaTenantTransactionClient & StaffServiceReadTransaction & {
  tenant: { findUnique(args: { where: { slug: string } }): Promise<{
    id: string; name: string; timezone: string; status: "ACTIVE" | "INACTIVE"; contactPhone: string | null;
    legalName: string | null; legalAddress: string | null; kvkkContactEmail: string | null;
    publicAddress: string | null; mapsUrl: string | null;
  } | null> };
  service: { findMany(args: { where: { tenantId: string; active: boolean }; orderBy: { name: "asc" } }): Promise<ServiceRecord[]> };
  serviceCategory: { findMany(args: { where: { tenantId: string }; orderBy: Array<{ sortOrder: "asc" } | { name: "asc" }>; select: { id: true; name: true; sortOrder: true } }): Promise<Array<{ id: string; name: string; sortOrder: number }>> };
  staff: { findMany(args: { where: { tenantId: string; status: "ACTIVE" }; orderBy: { id: "asc" } }): Promise<Array<{ id: string; profileId: string; status: "ACTIVE" }>> };
  profile: { findMany(args: { where: { tenantId: string; id: { in: string[] } } }): Promise<Array<{ id: string; displayName: string }>> };
  workingHours: { findMany(args: { where: { tenantId: string }; orderBy: { dayOfWeek: "asc" } }): Promise<WorkingHoursRecord[]> };
};

export function createPrismaPublicSalonRepository(prisma: PrismaTenantClient): PublicSalonRepository {
  return {
    async resolveBySlug(slug) {
      const tenant = await prisma.$transaction(async (tx) => (tx as Tx).tenant.findUnique({ where: { slug } }));
      if (!tenant) return null;
      return {
        tenantContext: { tenantId: tenant.id as never }, name: tenant.name, timezone: tenant.timezone,
        status: tenant.status === "ACTIVE" ? "ACTIVE" : "INACTIVE", contactPhone: tenant.contactPhone ?? null,
        legalName: tenant.legalName ?? null, legalAddress: tenant.legalAddress ?? null, kvkkContactEmail: tenant.kvkkContactEmail ?? null,
        publicAddress: tenant.publicAddress ?? null, mapsUrl: tenant.mapsUrl ?? null,
      };
    },
    async catalog(tenantContext: TenantContext) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const [services, staff, workingHours] = await Promise.all([
          tx.service.findMany({ where: { tenantId: tenantContext.tenantId, active: true }, orderBy: { name: "asc" } }),
          tx.staff.findMany({ where: { tenantId: tenantContext.tenantId, status: "ACTIVE" }, orderBy: { id: "asc" } }),
          tx.workingHours.findMany({ where: { tenantId: tenantContext.tenantId }, orderBy: { dayOfWeek: "asc" } }),
        ]);
        // Sequential on purpose: queries inside one interactive transaction share a connection.
        const categories = await tx.serviceCategory.findMany({
          where: { tenantId: tenantContext.tenantId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, sortOrder: true },
        });
        const profiles = await tx.profile.findMany({ where: { tenantId: tenantContext.tenantId, id: { in: staff.map((s) => s.profileId) } } });
        const names = new Map(profiles.map((p) => [p.id, p.displayName]));
        const performs = await readStaffServiceMap(tx, tenantContext.tenantId);
        return {
          services,
          categories,
          staff: staff.map((s) => ({ ...s, displayName: names.get(s.profileId) ?? "Staff", serviceIds: performs.get(s.id) ?? [] })),
          workingHours,
        };
      });
    },
  };
}
