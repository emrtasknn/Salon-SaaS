import type { AuthenticatedIdentity } from "../domain/auth-identity";
import type { AuthorizationMembership } from "../domain/authorization";
import type { TenantContext } from "../domain/tenant-context";

export type MembershipLookupInput = Readonly<{
  tenantContext: TenantContext;
  identity: AuthenticatedIdentity;
}>;

export type MembershipLookupResult =
  | Readonly<{
      status: "found";
      membership: AuthorizationMembership;
    }>
  | Readonly<{
      status: "not_found";
    }>
  | Readonly<{
      status: "error";
      error: "PERSISTENCE_FAILURE";
    }>;

export interface MembershipReader {
  readMembership(
    input: MembershipLookupInput,
  ): Promise<MembershipLookupResult>;
}

export function createMembershipLookupInput(
  tenantContext: TenantContext,
  identity: AuthenticatedIdentity,
): MembershipLookupInput {
  return Object.freeze({ tenantContext, identity });
}
