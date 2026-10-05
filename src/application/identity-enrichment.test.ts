import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedSubjectIdentity } from "../domain/auth-identity";
import { createTenantContext, createTenantId } from "../domain/tenant-context";
import type { MembershipReader } from "../persistence/membership";
import { enrichApplicationIdentity } from "./identity-enrichment";

function tenantContext(raw: string) {
  const result = createTenantId(raw);
  if (!result.ok) throw new Error(result.error.message);
  const context = createTenantContext({ tenantId: result.value });
  if (!context.ok) throw new Error(context.error.message);
  return context.value;
}

describe("enrichApplicationIdentity", () => {
  it("enriches a trusted subject with the profile from tenant membership", async () => {
    const subject = createAuthenticatedSubjectIdentity("subject-a");
    const reader: MembershipReader = {
      readMembership: vi.fn().mockResolvedValue({
        status: "found",
        membership: {
          tenantId: tenantContext("tenant-a").tenantId,
          subjectId: subject.subjectId,
          profileId: "profile-a",
          role: "STAFF",
        },
      }),
    };

    await expect(
      enrichApplicationIdentity(subject, tenantContext("tenant-a"), reader),
    ).resolves.toEqual({
      status: "enriched",
      identity: {
        state: "authenticated",
        subjectId: "subject-a",
        profileId: "profile-a",
      },
      membershipLookup: "found",
    });
  });

  it("fails closed when membership is missing", async () => {
    const subject = createAuthenticatedSubjectIdentity("subject-a");
    const reader: MembershipReader = {
      readMembership: vi.fn().mockResolvedValue({ status: "not_found" }),
    };

    await expect(
      enrichApplicationIdentity(subject, tenantContext("tenant-a"), reader),
    ).resolves.toEqual({
      status: "not_found",
      identity: { state: "unauthenticated" },
      membershipLookup: "not_found",
    });
  });

  it("fails closed when persistence fails", async () => {
    const subject = createAuthenticatedSubjectIdentity("subject-a");
    const reader: MembershipReader = {
      readMembership: vi.fn().mockResolvedValue({
        status: "error",
        error: "PERSISTENCE_FAILURE",
      }),
    };

    await expect(
      enrichApplicationIdentity(subject, tenantContext("tenant-a"), reader),
    ).resolves.toEqual({
      status: "persistence_failure",
      identity: { state: "unauthenticated" },
      membershipLookup: "persistence_failure",
    });
  });

  it("rejects a membership returned for another tenant", async () => {
    const subject = createAuthenticatedSubjectIdentity("subject-a");
    const reader: MembershipReader = {
      readMembership: vi.fn().mockResolvedValue({
        status: "found",
        membership: {
          tenantId: tenantContext("tenant-b").tenantId,
          subjectId: subject.subjectId,
          profileId: "profile-b",
          role: "SUPER_ADMIN",
        },
      }),
    };

    await expect(
      enrichApplicationIdentity(subject, tenantContext("tenant-a"), reader),
    ).resolves.toEqual({
      status: "not_found",
      identity: { state: "unauthenticated" },
      membershipLookup: "not_found",
    });
  });

  it("rejects a membership returned for another subject", async () => {
    const subject = createAuthenticatedSubjectIdentity("subject-a");
    const reader: MembershipReader = {
      readMembership: vi.fn().mockResolvedValue({
        status: "found",
        membership: {
          tenantId: tenantContext("tenant-a").tenantId,
          subjectId: "subject-b" as typeof subject.subjectId,
          profileId: "profile-b",
          role: "SUPER_ADMIN",
        },
      }),
    };

    await expect(
      enrichApplicationIdentity(subject, tenantContext("tenant-a"), reader),
    ).resolves.toEqual({
      status: "not_found",
      identity: { state: "unauthenticated" },
      membershipLookup: "not_found",
    });
  });

  it("never uses profile metadata from the authentication subject", async () => {
    const subject = createAuthenticatedSubjectIdentity("subject-a");
    const reader: MembershipReader = {
      readMembership: vi.fn().mockResolvedValue({
        status: "found",
        membership: {
          tenantId: tenantContext("tenant-a").tenantId,
          subjectId: subject.subjectId,
          profileId: "persisted-profile",
          role: "CUSTOMER",
        },
      }),
    };

    const result = await enrichApplicationIdentity(
      subject,
      tenantContext("tenant-a"),
      reader,
    );

    expect(result).toMatchObject({
      status: "enriched",
      identity: {
        profileId: "persisted-profile",
      },
    });
    expect(result).not.toMatchObject({
      identity: {
        profileId: "client-profile",
      },
    });
  });
});