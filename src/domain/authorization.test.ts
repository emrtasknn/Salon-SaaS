import { describe, expect, it } from "vitest";

import {
  createAuthenticatedIdentity,
  createAuthSubjectId,
  createUnauthenticatedIdentity,
} from "./auth-identity";
import { createTenantContext, createTenantId } from "./tenant-context";
import {
  authorize,
  type AuthorizationMembership,
  type TenantRole,
} from "./authorization";

function validTenantId(raw: string) {
  const result = createTenantId(raw);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("Test fixture tenant ID must be valid");
  }
  return result.value;
}

function validTenantContext(raw: string) {
  const result = createTenantContext({ tenantId: validTenantId(raw) });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("Test fixture tenant context must be valid");
  }
  return result.value;
}

function membership(
  tenantId: string,
  subjectId: string,
  profileId: string,
  role: TenantRole,
): AuthorizationMembership {
  return {
    tenantId: validTenantId(tenantId),
    subjectId: createAuthSubjectId(subjectId),
    profileId,
    role,
  };
}

describe("authorization foundation", () => {
  it("allows an authenticated member with the required role", () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");

    expect(
      authorize({
        identity,
        tenantContext: validTenantContext("tenant-1"),
        membership: membership(
          "tenant-1",
          identity.subjectId,
          identity.profileId,
          "STAFF",
        ),
        requiredRole: "CUSTOMER",
      }),
    ).toEqual({ status: "allowed", role: "STAFF" });
  });

  it("denies unauthenticated identities", () => {
    expect(
      authorize({
        identity: createUnauthenticatedIdentity(),
        tenantContext: validTenantContext("tenant-1"),
        membership: null,
        requiredRole: "CUSTOMER",
      }),
    ).toEqual({ status: "denied", reason: "UNAUTHENTICATED" });
  });

  it("denies missing membership", () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");

    expect(
      authorize({
        identity,
        tenantContext: validTenantContext("tenant-1"),
        membership: null,
        requiredRole: "STAFF",
      }),
    ).toEqual({ status: "denied", reason: "MISSING_MEMBERSHIP" });
  });

  it("denies a membership from another tenant", () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");

    expect(
      authorize({
        identity,
        tenantContext: validTenantContext("tenant-1"),
        membership: membership(
          "tenant-2",
          identity.subjectId,
          identity.profileId,
          "TENANT_ADMIN",
        ),
        requiredRole: "STAFF",
      }),
    ).toEqual({ status: "denied", reason: "TENANT_MISMATCH" });
  });

  it("denies a membership with a different identity", () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");

    expect(
      authorize({
        identity,
        tenantContext: validTenantContext("tenant-1"),
        membership: membership(
          "tenant-1",
          "subject-2",
          "profile-2",
          "TENANT_ADMIN",
        ),
        requiredRole: "STAFF",
      }),
    ).toEqual({ status: "denied", reason: "IDENTITY_MISMATCH" });
  });

  it("denies an insufficient role", () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");

    expect(
      authorize({
        identity,
        tenantContext: validTenantContext("tenant-1"),
        membership: membership(
          "tenant-1",
          identity.subjectId,
          identity.profileId,
          "STAFF",
        ),
        requiredRole: "TENANT_ADMIN",
      }),
    ).toEqual({ status: "denied", reason: "INSUFFICIENT_ROLE" });
  });

  it("allows explicit SUPER_ADMIN role for a tenant-scoped request", () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");

    expect(
      authorize({
        identity,
        tenantContext: validTenantContext("tenant-1"),
        membership: membership(
          "tenant-1",
          identity.subjectId,
          identity.profileId,
          "SUPER_ADMIN",
        ),
        requiredRole: "TENANT_ADMIN",
      }),
    ).toEqual({ status: "allowed", role: "SUPER_ADMIN" });
  });

  it("does not accept an arbitrary client tenantId as authorization input", () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");

    expect(
      authorize({
        identity,
        tenantContext: {
          tenantId: "trusted-tenant",
        },
        membership: membership(
          "attacker-selected-tenant",
          identity.subjectId,
          identity.profileId,
          "TENANT_ADMIN",
        ),
        requiredRole: "TENANT_ADMIN",
      }),
    ).toEqual({ status: "denied", reason: "TENANT_MISMATCH" });
  });

  it("fails closed for malformed authorization requests", () => {
    expect(authorize(null)).toEqual({
      status: "denied",
      reason: "INVALID_REQUEST",
    });
  });
});
