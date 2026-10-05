import type {
  ApplicationIdentity,
  AuthenticatedSubjectIdentity,
} from "../domain/auth-identity";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import {
  createMembershipLookupInput,
  type MembershipReader,
} from "../persistence/membership";

export type IdentityEnrichmentResult =
  | Readonly<{
      status: "enriched";
      identity: ApplicationIdentity;
      membershipLookup: "found";
    }>
  | Readonly<{
      status: "not_found";
      identity: Readonly<{ state: "unauthenticated" }>;
      membershipLookup: "not_found";
    }>
  | Readonly<{
      status: "persistence_failure";
      identity: Readonly<{ state: "unauthenticated" }>;
      membershipLookup: "persistence_failure";
    }>;

export async function enrichApplicationIdentity(
  subjectIdentity: AuthenticatedSubjectIdentity,
  tenantContext: TenantContext,
  membershipReader: MembershipReader,
): Promise<IdentityEnrichmentResult> {
  const lookup = await membershipReader.readMembership(
    createMembershipLookupInput(tenantContext, subjectIdentity),
  );

  if (lookup.status === "error") {
    return Object.freeze({
      status: "persistence_failure",
      identity: { state: "unauthenticated" as const },
      membershipLookup: "persistence_failure",
    });
  }

  if (lookup.status === "not_found") {
    return Object.freeze({
      status: "not_found",
      identity: { state: "unauthenticated" as const },
      membershipLookup: "not_found",
    });
  }

  if (
    lookup.membership.tenantId !== tenantContext.tenantId ||
    lookup.membership.subjectId !== subjectIdentity.subjectId
  ) {
    return Object.freeze({
      status: "not_found",
      identity: { state: "unauthenticated" as const },
      membershipLookup: "not_found",
    });
  }

  return Object.freeze({
    status: "enriched",
    identity: createAuthenticatedIdentity(
      subjectIdentity.subjectId,
      lookup.membership.profileId,
    ),
    membershipLookup: "found",
  });
}
