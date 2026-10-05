import { describe, expect, it, vi } from "vitest";
import {
  createAuthenticatedIdentity,
  createUnauthenticatedIdentity,
} from "../domain/auth-identity";
import { createTenantContext, createTenantId } from "../domain/tenant-context";
import type { MembershipReader } from "../persistence/membership";
import {
  evaluateAuthorization,
  type AuthorizationCompositionRequest,
} from "./authorization-composition";

const tenantId = createTenantId("tenant-a");
if (!tenantId.ok) throw new Error("Test tenant ID setup failed");
const otherTenantId = createTenantId("tenant-b");
if (!otherTenantId.ok) throw new Error("Test tenant ID setup failed");
const tenantContext = createTenantContext({ tenantId: tenantId.value });
if (!tenantContext.ok) throw new Error("Test tenant context setup failed");
const otherTenantContext = createTenantContext({ tenantId: otherTenantId.value });
if (!otherTenantContext.ok) throw new Error("Test tenant context setup failed");

const identity = createAuthenticatedIdentity("subject-a", "profile-a");

function membershipReader(
  result: Awaited<ReturnType<MembershipReader["readMembership"]>>,
): MembershipReader {
  return { readMembership: vi.fn().mockResolvedValue(result) };
}

describe("evaluateAuthorization", () => {
  it("allows a matching membership with sufficient role", async () => {
    const result = await evaluateAuthorization(
      { identity, tenantContext: tenantContext.value, requiredRole: "CUSTOMER" },
      membershipReader({
        status: "found",
        membership: {
          tenantId: tenantId.value,
          subjectId: identity.subjectId,
          profileId: identity.profileId,
          role: "STAFF",
        },
      }),
    );
    expect(result.authorization).toEqual({ status: "allowed", role: "STAFF" });
    expect(result.membershipLookup).toBe("found");
  });

  it("fails closed without reading membership for unauthenticated identity", async () => {
    const readMembership = vi.fn();
    const reader: MembershipReader = { readMembership };
    const result = await evaluateAuthorization(
      {
        identity: createUnauthenticatedIdentity(),
        tenantContext: tenantContext.value,
        requiredRole: "CUSTOMER",
      },
      reader,
    );
    expect(result.authorization).toEqual({
      status: "denied",
      reason: "UNAUTHENTICATED",
    });
    expect(result.membershipLookup).toBe("skipped_unauthenticated");
    expect(readMembership).not.toHaveBeenCalled();
  });

  it("denies when membership is missing", async () => {
    const result = await evaluateAuthorization(
      { identity, tenantContext: tenantContext.value, requiredRole: "STAFF" },
      membershipReader({ status: "not_found" }),
    );
    expect(result.authorization).toEqual({
      status: "denied",
      reason: "MISSING_MEMBERSHIP",
    });
    expect(result.membershipLookup).toBe("not_found");
  });

  it("fails closed when persistence fails", async () => {
    const result = await evaluateAuthorization(
      { identity, tenantContext: tenantContext.value, requiredRole: "STAFF" },
      membershipReader({ status: "error", error: "PERSISTENCE_FAILURE" }),
    );
    expect(result.authorization).toEqual({
      status: "denied",
      reason: "MISSING_MEMBERSHIP",
    });
    expect(result.membershipLookup).toBe("persistence_failure");
  });

  it("preserves tenant mismatch denial", async () => {
    const result = await evaluateAuthorization(
      { identity, tenantContext: tenantContext.value, requiredRole: "CUSTOMER" },
      membershipReader({
        status: "found",
        membership: {
          tenantId: otherTenantId.value,
          subjectId: identity.subjectId,
          profileId: identity.profileId,
          role: "SUPER_ADMIN",
        },
      }),
    );
    expect(result.authorization).toEqual({
      status: "denied",
      reason: "TENANT_MISMATCH",
    });
  });

  it("preserves identity mismatch denial", async () => {
    const result = await evaluateAuthorization(
      { identity, tenantContext: tenantContext.value, requiredRole: "CUSTOMER" },
      membershipReader({
        status: "found",
        membership: {
          tenantId: tenantId.value,
          subjectId: "different-subject" as typeof identity.subjectId,
          profileId: identity.profileId,
          role: "SUPER_ADMIN",
        },
      }),
    );
    expect(result.authorization).toEqual({
      status: "denied",
      reason: "IDENTITY_MISMATCH",
    });
  });

  it("preserves insufficient-role denial", async () => {
    const result = await evaluateAuthorization(
      {
        identity,
        tenantContext: tenantContext.value,
        requiredRole: "TENANT_ADMIN",
      },
      membershipReader({
        status: "found",
        membership: {
          tenantId: tenantId.value,
          subjectId: identity.subjectId,
          profileId: identity.profileId,
          role: "STAFF",
        },
      }),
    );
    expect(result.authorization).toEqual({
      status: "denied",
      reason: "INSUFFICIENT_ROLE",
    });
  });
});
