import type { AuthenticatedSubjectIdentity } from "../domain/auth-identity";
import type { AuthorizationMembership } from "../domain/authorization";
import type { TenantContext } from "../domain/tenant-context";

export type MembershipLookupInput = Readonly<{
  tenantContext: TenantContext;
  identity: AuthenticatedSubjectIdentity;
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
  identity: AuthenticatedSubjectIdentity,
): MembershipLookupInput {
  return Object.freeze({ tenantContext, identity });
}
