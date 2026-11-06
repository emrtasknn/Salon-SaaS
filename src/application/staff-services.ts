import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import { STAFF_SERVICE_MAX } from "../domain/staff-service";

/** Owner decision 2026-11-06: TENANT_ADMIN sets which services each staff member performs. */
export type StaffServiceRepository = Readonly<{
  /** staffId -> mapped service ids; staff without rows are absent (= every service). */
  list(tenantContext: TenantContext): Promise<Map<string, string[]>>;
  /** Replaces the staff member's whole set in one transaction; [] = every service. */
  replace(tenantContext: TenantContext, staffId: string, serviceIds: ReadonlyArray<string>): Promise<"updated" | "not_found" | "invalid_service">;
}>;

export type StaffServiceAuthorizer = Readonly<{
  authorize(identity: ApplicationIdentity, tenantContext: TenantContext, requiredRole: "TENANT_ADMIN"): Promise<boolean>;
}>;

type Failure = Readonly<{ status: "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "PERSISTENCE_FAILURE" }>;

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

export function createStaffServiceManager(dependencies: Readonly<{ authorizer: StaffServiceAuthorizer; repository: StaffServiceRepository }>) {
  const allowed = (identity: ApplicationIdentity, tenantContext: TenantContext) =>
    dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN");

  return {
    async list(identity: ApplicationIdentity, tenantContext: TenantContext) {
      if (!(await allowed(identity, tenantContext))) return { status: "UNAUTHORIZED" } as Failure;
      try {
        const map = await dependencies.repository.list(tenantContext);
        return { status: "listed" as const, byStaff: Object.fromEntries(map) as Record<string, string[]> };
      } catch {
        return { status: "PERSISTENCE_FAILURE" } as Failure;
      }
    },

    async set(identity: ApplicationIdentity, tenantContext: TenantContext, staffId: unknown, serviceIds: unknown) {
      if (!(await allowed(identity, tenantContext))) return { status: "UNAUTHORIZED" } as Failure;
      if (!isId(staffId) || !Array.isArray(serviceIds) || serviceIds.length > STAFF_SERVICE_MAX || !serviceIds.every(isId)) {
        return { status: "INVALID_INPUT" } as Failure;
      }
      const unique = [...new Set(serviceIds as string[])];
      try {
        const result = await dependencies.repository.replace(tenantContext, staffId, unique);
        if (result === "not_found") return { status: "NOT_FOUND" } as Failure;
        if (result === "invalid_service") return { status: "INVALID_INPUT" } as Failure;
        return { status: "updated" as const };
      } catch {
        return { status: "PERSISTENCE_FAILURE" } as Failure;
      }
    },
  };
}
