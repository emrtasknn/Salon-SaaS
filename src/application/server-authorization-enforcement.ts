import type { ApplicationIdentity } from "../domain/auth-identity";
import type {
  AuthorizationResult,
  TenantRole,
} from "../domain/authorization";
import type { TenantContext } from "../domain/tenant-context";
import {
  evaluateAuthorization,
  type AuthorizationCompositionResult,
} from "./authorization-composition";
import type { MembershipReader } from "../persistence/membership";

export type ServerAuthorizationRequest = Readonly<{
  identity: ApplicationIdentity;
  tenantContext: TenantContext;
  requiredRole: TenantRole;
}>;

export type ServerAuthorizationDecision = Readonly<{
  authorization: AuthorizationResult;
  membershipLookup: AuthorizationCompositionResult["membershipLookup"];
}>;

export async function enforceServerAuthorization(
  request: ServerAuthorizationRequest,
  membershipReader: MembershipReader,
): Promise<ServerAuthorizationDecision> {
  const result = await evaluateAuthorization(request, membershipReader);

  return Object.freeze({
    authorization: result.authorization,
    membershipLookup: result.membershipLookup,
  });
}
