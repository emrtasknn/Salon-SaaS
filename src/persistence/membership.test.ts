import { describe, expect, it } from "vitest";

import { createAuthenticatedIdentity } from "../domain/auth-identity";
import { createTenantContext, createTenantId } from "../domain/tenant-context";
import {
  createMembershipLookupInput,
  type MembershipReader,
} from "./membership";

function tenantContext(raw: string) {
  const tenantIdResult = createTenantId(raw);
  if (!tenantIdResult.ok) {
    throw new Error("Test fixture tenant ID must be valid");
  }

  const result = createTenantContext({ tenantId: tenantIdResult.value });
  if (!result.ok) {
    throw new Error("Test fixture tenant context must be valid");
  }
  return result.value;
}

describe("membership persistence boundary", () => {
  it("uses trusted tenant context and authenticated identity as the lookup boundary", async () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");
    const input = createMembershipLookupInput(
      tenantContext("tenant-1"),
      identity,
    );

    const reader: MembershipReader = {
      readMembership: async (lookup) => {
        expect(lookup.tenantContext.tenantId).toBe("tenant-1");
        expect(lookup.identity.subjectId).toBe(identity.subjectId);
        expect(lookup.identity.profileId).toBe("profile-1");

        return { status: "not_found" };
      }),
    };

    await expect(reader.readMembership(input)).resolves.toEqual({
      status: "not_found",
    });
  });

  it("returns a found authorization membership without changing its shape", async () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");
    const input = createMembershipLookupInput(
      tenantContext("tenant-1"),
      identity,
    );
    const membership = {
      tenantId: input.tenantContext.tenantId,
      subjectId: identity.subjectId,
      profileId: identity.profileId,
      role: "STAFF" as const,
    };

    const reader: MembershipReader = {
      readMembership: async () => ({
        status: "found",
        membership,
      }),
    };

    await expect(reader.readMembership(input)).resolves.toEqual({
      status: "found",
      membership,
    });
  });

  it("keeps persistence failure distinct from membership absence", async () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");
    const input = createMembershipLookupInput(
      tenantContext("tenant-1"),
      identity,
    );

    const reader: MembershipReader = {
      readMembership: async () => ({
        status: "error",
        error: "PERSISTENCE_FAILURE",
      }),
    };

    const result = await reader.readMembership(input);

    expect(result).toEqual({
      status: "error",
      error: "PERSISTENCE_FAILURE",
    });
    expect(result.status).not.toBe("found");
  });

  it("does not expose a client tenantId as a lookup authority", () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");
    const input = createMembershipLookupInput(
      tenantContext("trusted-tenant"),
      identity,
    );

    expect(input).not.toHaveProperty("tenantId");
    expect(input).not.toHaveProperty("clientTenantId");
    expect(input.tenantContext.tenantId).toBe("trusted-tenant");
  });
});
