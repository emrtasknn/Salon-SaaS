import type { TenantRole } from "./authorization";

/**
 * Roles that may use the staff workspace (/staff) for their OWN staff row.
 * A TENANT_ADMIN qualifies only when they also serve customers (owner decision 2026-11-05):
 * callers must still require an ACTIVE Staff row for the membership profile in the same tenant.
 * SUPER_ADMIN and CUSTOMER never qualify.
 */
export function isStaffWorkspaceRole(role: TenantRole): boolean {
  return role === "STAFF" || role === "TENANT_ADMIN";
}
