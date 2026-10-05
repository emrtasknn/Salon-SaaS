import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedSubjectIdentity } from "../domain/auth-identity";
import { createTenantContext, createTenantId } from "../domain/tenant-context";
import { createPrismaMembershipReader } from "./prisma-membership-reader";

function tenantContext(value: string) {
  const id = createTenantId(value);
  if (!id.ok) throw new Error(id.error.message);
  const context = createTenantContext({ tenantId: id.value });
  if (!context.ok) throw new Error(context.error.message);
  return context.value;
}

function authenticatedIdentity(subjectId: string) {
  return createAuthenticatedSubjectIdentity(subjectId);
}

describe("Prisma MembershipReader", () => {
  it("returns the matching membership for tenant and subject", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      tenantId: "tenant-a",
      subjectId: "subject-1",
      profileId: "profile-1",
      role: "STAFF",
    });
    const reader = createPrismaMembershipReader({
      tenantMembership: { findUnique },
    });

    const result = await reader.readMembership({
      tenantContext: tenantContext("tenant-a"),
      identity: authenticatedIdentity("subject-1"),
    });

    expect(result).toEqual({
      status: "found",
      membership: {
        tenantId: "tenant-a",
        subjectId: "subject-1",
        profileId: "profile-1",
        role: "STAFF",
      },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_subjectId: {
          tenantId: "tenant-a",
          subjectId: "subject-1",
        },
      },
    });
  });

  it("returns not_found when no membership exists", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const reader = createPrismaMembershipReader({
      tenantMembership: { findUnique },
    });

    await expect(
      reader.readMembership({
        tenantContext: tenantContext("tenant-a"),
        identity: authenticatedIdentity("subject-1"),
      }),
    ).resolves.toEqual({ status: "not_found" });
  });

  it("keeps tenant and subject in the persistence lookup boundary", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const reader = createPrismaMembershipReader({
      tenantMembership: { findUnique },
    });

    await reader.readMembership({
      tenantContext: tenantContext("tenant-b"),
      identity: authenticatedIdentity("subject-2"),
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_subjectId: {
          tenantId: "tenant-b",
          subjectId: "subject-2",
        },
      },
    });
  });

  it("returns persistence failure instead of granting an authorization result", async () => {
    const findUnique = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const reader = createPrismaMembershipReader({
      tenantMembership: { findUnique },
    });

    await expect(
      reader.readMembership({
        tenantContext: tenantContext("tenant-a"),
        identity: authenticatedIdentity("subject-1"),
      }),
    ).resolves.toEqual({
      status: "error",
      error: "PERSISTENCE_FAILURE",
    });
  });
});
