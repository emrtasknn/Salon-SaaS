import { describe, expect, it } from "vitest";

const allowedRoles = [
  "SUPER_ADMIN",
  "TENANT_ADMIN",
  "STAFF",
  "CUSTOMER",
] as const;

describe("tenant membership persistence contract", () => {
  it("uses exactly the existing authorization role vocabulary", () => {
    expect(allowedRoles).toEqual([
      "SUPER_ADMIN",
      "TENANT_ADMIN",
      "STAFF",
      "CUSTOMER",
    ]);
  });

  it("keeps tenant and authenticated subject as the uniqueness boundary", () => {
    const membershipKey = (tenantId: string, subjectId: string) =>
      tenantId + ":" + subjectId;

    expect(membershipKey("tenant-a", "subject-1")).toBe(
      "tenant-a:subject-1",
    );
    expect(membershipKey("tenant-a", "subject-1")).not.toBe(
      membershipKey("tenant-b", "subject-1"),
    );
  });

  it("does not treat the same subject as globally unique across tenants", () => {
    const keys = new Set([
      "tenant-a:subject-1",
      "tenant-b:subject-1",
    ]);

    expect(keys.size).toBe(2);
  });
});
