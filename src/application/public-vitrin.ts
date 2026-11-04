import type { TenantContext } from "../domain/tenant-context";
import type { ServiceRecord } from "../domain/service";
import type { StaffRecord } from "../domain/staff";
import type { WorkingHoursRecord } from "../domain/working-hours";
import { whatsAppLink, type TenantStatus } from "../domain/tenant";

export type PublicSalonRepository = Readonly<{
  /** WP-07: `status` and `contactPhone` are additive, server-only fields (never forwarded to client props). */
  resolveBySlug(slug: string): Promise<Readonly<{
    tenantContext: TenantContext; name: string; timezone: string; status: TenantStatus; contactPhone: string | null;
  }> | null>;
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
      // WP-07: expose only a boolean + the derived wa.me URL; raw status/phone stay server-side.
      const salon = {
        tenantContext: resolved.tenantContext,
        name: resolved.name,
        timezone: resolved.timezone,
        active: resolved.status === "ACTIVE",
        whatsAppUrl: whatsAppLink(resolved.contactPhone),
      };
      // An inactive salon shows no catalog (no services / booking links).
      if (!salon.active) {
        const empty: Awaited<ReturnType<PublicSalonRepository["catalog"]>> = { services: [], staff: [], workingHours: [] };
        return { status: "ok" as const, ...salon, ...empty };
      }
      try {
        const catalog = await repository.catalog(resolved.tenantContext);
        return { status: "ok" as const, ...salon, ...catalog };
      } catch {
        return { status: "PERSISTENCE_FAILURE" as const };
      }
    },
  };
}
