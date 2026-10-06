import type { TenantContext } from "../domain/tenant-context";
import type { ServiceRecord } from "../domain/service";
import type { StaffRecord } from "../domain/staff";
import type { WorkingHoursRecord } from "../domain/working-hours";

export type PublicSalonRepository = Readonly<{
  resolveBySlug(slug: string): Promise<Readonly<{ tenantContext: TenantContext; name: string; timezone: string }> | null>;
  catalog(tenantContext: TenantContext): Promise<Readonly<{
    services: ReadonlyArray<ServiceRecord>;
    staff: ReadonlyArray<Readonly<Pick<StaffRecord, "id" | "profileId" | "status"> & { displayName: string }>>;
    workingHours: ReadonlyArray<WorkingHoursRecord>;
  }>>;
}>;

export function createPublicVitrin(repository: PublicSalonRepository) {
  return {
    async load(slug: unknown) {
      if (typeof slug !== "string" || !slug.trim()) return { status: "INVALID_INPUT" as const };
      const resolved = await repository.resolveBySlug(slug.trim().toLowerCase());
      if (!resolved) return { status: "NOT_FOUND" as const };
      try {
        const catalog = await repository.catalog(resolved.tenantContext);
        return { status: "ok" as const, ...resolved, ...catalog };
      } catch {
        return { status: "PERSISTENCE_FAILURE" as const };
      }
    },
  };
}
