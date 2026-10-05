import { describe, expect, it, vi } from "vitest";
import {
  createAuthenticatedIdentity,
  createUnauthenticatedIdentity,
} from "../domain/auth-identity";
import { createTenantContext, createTenantId } from "../domain/tenant-context";
import type { MembershipReader } from "../persistence/membership";
import { enforceServerAuthorization } from "./server-authorization-enforcement";

function tenantContext() {
  const result = createTenantContext({
    tenantId: createTenantId("tenant-1").value,
  });
  if (!result.ok) throw new Error("test setup failed");
  return result.value;
}

function membershipReader(
  result: Awaited<ReturnType<MembershipReader["readMembership"]>>,
): MembershipReader {
  return {
    readMembership: vi.fn().mockResolvedValue(result),
  };
}

describe("enforceServerAuthorization", () => {
  it("allows an authenticated matching member", async () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");
    const tenant = tenantContext();

    const result = await enforceServerAuthorization(
      { identity, tenantContext: tenant, requiredRole: "STAFF" },
      membershipReader({
        status: "found",
        membership: {
          tenantId: tenant.tenantId,
          subjectId: identity.subjectId,
          profileId: "profile-1",
          role: "STAFF",
        },
      }),
    );

    expect(result.authorization).toEqual({
      status: "allowed",
      role: "STAFF",
    });
    expect(result.membershipLookup).toBe("found");
  });

  it("denies an unauthenticated request without reading membership", async () => {
    const reader = membershipReader({ status: "not_found" });

    const result = await enforceServerAuthorization(
      {
        identity: createUnauthenticatedIdentity(),
        tenantContext: tenantContext(),
        requiredRole: "STAFF",
      },
      reader,
    );

    expect(result.authorization.status).toBe("denied");
    expect(result.membershipLookup).toBe("skipped_unauthenticated");
    expect(reader.readMembership).not.toHaveBeenCalled();
  });

  it("fails closed when membership is missing", async () => {
    const result = await enforceServerAuthorization(
      {
        identity: createAuthenticatedIdentity("subject-1", "profile-1"),
        tenantContext: tenantContext(),
        requiredRole: "STAFF",
      },
      membershipReader({ status: "not_found" }),
    );

    expect(result.authorization).toEqual({
      status: "denied",
      reason: "MISSING_MEMBERSHIP",
    });
  });

  it("fails closed on persistence failure", async () => {
    const result = await enforceServerAuthorization(
      {
        identity: createAuthenticatedIdentity("subject-1", "profile-1"),
        tenantContext: tenantContext(),
        requiredRole: "STAFF",
      },
      membershipReader({
        status: "error",
        error: "PERSISTENCE_FAILURE",
      }),
    );

    expect(result.authorization).toEqual({
      status: "denied",
      reason: "MISSING_MEMBERSHIP",
    });
    expect(result.membershipLookup).toBe("persistence_failure");
  });

  it("preserves tenant mismatch denial", async () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");
    const tenant = tenantContext();
    const otherTenant = createTenantId("tenant-2");

    const result = await enforceServerAuthorization(
      {
        identity,
        tenantContext: tenant,
        requiredRole: "STAFF",
      },
      membershipReader({
        status: "found",
        membership: {
          tenantId: otherTenant,
          subjectId: identity.subjectId,
          profileId: "profile-1",
          role: "STAFF",
        },
      }),
    );

    expect(result.authorization).toEqual({
      status: "denied",
      reason: "TENANT_MISMATCH",
    });
  });

  it("preserves identity mismatch denial", async () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");
    const tenant = tenantContext();

    const result = await enforceServerAuthorization(
      {
        identity,
        tenantContext: tenant,
        requiredRole: "STAFF",
      },
      membershipReader({
        status: "found",
        membership: {
          tenantId: tenant.tenantId,
          subjectId: createAuthenticatedIdentity("subject-2", "profile-2").subjectId,
          profileId: "profile-2",
          role: "STAFF",
        },
      }),
    );

    expect(result.authorization).toEqual({
      status: "denied",
      reason: "IDENTITY_MISMATCH",
    });
  });

  it("preserves insufficient-role denial", async () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");
    const tenant = tenantContext();

    const result = await enforceServerAuthorization(
      {
        identity,
        tenantContext: tenant,
        requiredRole: "TENANT_ADMIN",
      },
      membershipReader({
        status: "found",
        membership: {
          tenantId: tenant.tenantId,
          subjectId: identity.subjectId,
          profileId: "profile-1",
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
