import type { ApplicationIdentity } from "../domain/auth-identity";
import type { AppointmentRecord } from "../domain/appointment";
import type { TenantContext } from "../domain/tenant-context";

export type StaffDecisionAuthorizationDependencies = Readonly<{
  membershipReader: {
    readMembership(input: { tenantContext: TenantContext; identity: Extract<ApplicationIdentity, { state: "authenticated" }>}): Promise<
      | { status: "found"; membership: { role: "STAFF" | "TENANT_ADMIN" | "SUPER_ADMIN"; profileId: string } }
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
  if (identity.state !== "authenticated") return false;
  if (appointment.tenantId !== tenantContext.tenantId) return false;
  if (appointment.status !== "PENDING") return false;
  const membership = await dependencies.membershipReader.readMembership({ tenantContext, identity });
  if (membership.status !== "found" || membership.membership.role !== "STAFF") return false;
  const staff = await dependencies.staffReader.findByProfileId(tenantContext, membership.membership.profileId);
  return staff !== null && staff.status === "ACTIVE" && staff.id === appointment.staffId && staff.tenantId === appointment.tenantId;
}
