import type { ApplicationIdentity } from "../domain/auth-identity";
import {
  authorize,
  type AuthorizationResult,
  type TenantRole,
} from "../domain/authorization";
import type { TenantContext } from "../domain/tenant-context";
import {
  createMembershipLookupInput,
  type MembershipReader,
} from "../persistence/membership";

export type AuthorizationCompositionRequest = Readonly<{
  identity: ApplicationIdentity;
  tenantContext: TenantContext;
  requiredRole: TenantRole;
}>;

export type AuthorizationCompositionResult = Readonly<{
  authorization: AuthorizationResult;
  membershipLookup:
    | "skipped_unauthenticated"
    | "not_found"
    | "found"
    | "persistence_failure";
}>;

export async function evaluateAuthorization(
  request: AuthorizationCompositionRequest,
  membershipReader: MembershipReader,
): Promise<AuthorizationCompositionResult> {
  if (request.identity.state === "unauthenticated") {
    return Object.freeze({
      authorization: authorize({
        identity: request.identity,
        tenantContext: request.tenantContext,
        membership: null,
        requiredRole: request.requiredRole,
      }),
      membershipLookup: "skipped_unauthenticated",
    });
  }

  const lookup = await membershipReader.readMembership(
    createMembershipLookupInput(request.tenantContext, request.identity),
  );

  if (lookup.status === "error") {
    return Object.freeze({
      authorization: authorize({
        identity: request.identity,
        tenantContext: request.tenantContext,
        membership: null,
        requiredRole: request.requiredRole,
      }),
      membershipLookup: "persistence_failure",
    });
  }

  if (lookup.status === "not_found") {
    return Object.freeze({
      authorization: authorize({
        identity: request.identity,
        tenantContext: request.tenantContext,
        membership: null,
        requiredRole: request.requiredRole,
      }),
      membershipLookup: "not_found",
    });
  }

  return Object.freeze({
    authorization: authorize({
      identity: request.identity,
      tenantContext: request.tenantContext,
      membership: lookup.membership,
      requiredRole: request.requiredRole,
    }),
    membershipLookup: "found",
  });
}
