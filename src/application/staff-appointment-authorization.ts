import type { ApplicationIdentity } from "../domain/auth-identity";
import type { AppointmentRecord } from "../domain/appointment";
import type { TenantContext } from "../domain/tenant-context";
import type { TenantRole } from "../domain/authorization";
import { isStaffWorkspaceRole } from "../domain/staff-workspace";

export type StaffDecisionAuthorizationDependencies = Readonly<{
  membershipReader: {
    readMembership(input: { tenantContext: TenantContext; identity: Extract<ApplicationIdentity, { state: "authenticated" }>}): Promise<
      | { status: "found"; membership: { role: TenantRole; profileId: string } }
      | { status: "not_found" }
      | { status: "error"; error: string }
    >;
  };
  staffReader: {
    findByProfileId(tenantContext: TenantContext, profileId: string): Promise<{ id: string; tenantId: string; profileId: string; status: "ACTIVE" | "INACTIVE" } | null>;
  };
}>;

export async function authorizeStaffDecision(
  dependencies: StaffDecisionAuthorizationDependencies,
  identity: ApplicationIdentity,
  tenantContext: TenantContext,
  appointment: AppointmentRecord,
): Promise<boolean> {
  if (appointment.status !== "PENDING") return false;
  return isAssignedActiveStaff(dependencies, identity, tenantContext, appointment);
}

/**
 * Owner decision 2026-11-06: the assigned ACTIVE staff member may mark their own CONFIRMED
 * appointment COMPLETED (the start-time rule is enforced by the booking engine). Never cancel.
 */
export async function authorizeStaffCompletion(
  dependencies: StaffDecisionAuthorizationDependencies,
  identity: ApplicationIdentity,
  tenantContext: TenantContext,
  appointment: AppointmentRecord,
): Promise<boolean> {
  if (appointment.status !== "CONFIRMED") return false;
  return isAssignedActiveStaff(dependencies, identity, tenantContext, appointment);
}

async function isAssignedActiveStaff(
  dependencies: StaffDecisionAuthorizationDependencies,
  identity: ApplicationIdentity,
  tenantContext: TenantContext,
  appointment: AppointmentRecord,
): Promise<boolean> {
  if (identity.state !== "authenticated") return false;
  if (appointment.tenantId !== tenantContext.tenantId) return false;
  const membership = await dependencies.membershipReader.readMembership({ tenantContext, identity });
  // STAFF, or a TENANT_ADMIN who also serves customers; both need their own ACTIVE staff row below.
  if (membership.status !== "found" || !isStaffWorkspaceRole(membership.membership.role)) return false;
  const staff = await dependencies.staffReader.findByProfileId(tenantContext, membership.membership.profileId);
  return staff !== null && staff.status === "ACTIVE" && staff.id === appointment.staffId && staff.tenantId === appointment.tenantId;
}
