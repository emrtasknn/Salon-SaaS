import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import type { AppointmentCreateScope } from "./booking-engine";
import type { StaffDecisionAuthorizationDependencies } from "./staff-appointment-authorization";

/**
 * WP-08: resolves who may create an appointment on behalf of a customer.
 * TENANT_ADMIN (or SUPER_ADMIN, via the role hierarchy) -> admin scope (any ACTIVE staff).
 * STAFF with an ACTIVE staff row in this tenant -> staff scope with their own staffId,
 * read server-side from the membership profile (never from client input).
 */
export async function resolveAppointmentCreateScope(
  dependencies: StaffDecisionAuthorizationDependencies & Readonly<{
    authorizeAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean>;
  }>,
  identity: ApplicationIdentity,
  tenantContext: TenantContext,
): Promise<AppointmentCreateScope | null> {
  if (identity.state !== "authenticated") return null;
  if (await dependencies.authorizeAdmin(identity, tenantContext)) return { kind: "admin" };
  const membership = await dependencies.membershipReader.readMembership({ tenantContext, identity });
  if (membership.status !== "found" || membership.membership.role !== "STAFF") return null;
  const staff = await dependencies.staffReader.findByProfileId(tenantContext, membership.membership.profileId);
  if (!staff || staff.status !== "ACTIVE" || staff.tenantId !== tenantContext.tenantId) return null;
  return { kind: "staff", staffId: staff.id };
}
