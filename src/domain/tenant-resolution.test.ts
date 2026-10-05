import { describe, expect, it } from "vitest";

import { createTenantId } from "./tenant-context";
import { resolveTenantContext } from "./tenant-resolution";

describe("tenant resolution foundation", () => {
  it("resolves a valid slug through the trusted resolver boundary", () => {
    const result = resolveTenantContext(
      { slug: "salon-abc" },
      (slug) => (slug === "salon-abc" ? createTenantId("tenant-abc") : null),
    );

    expect(result).toEqual({
      status: "resolved",
      context: { tenantId: "tenant-abc" },
    });
  });

  it("rejects malformed tenant context input", () => {
    expect(resolveTenantContext(null, () => null).status).toBe("invalid_input");
    expect(resolveTenantContext({}, () => null).status).toBe("invalid_input");
    expect(resolveTenantContext({ slug: "" }, () => null).status).toBe("invalid_input");
    expect(resolveTenantContext({ slug: " salon-abc" }, () => null).status).toBe("invalid_input");
    expect(resolveTenantContext({ slug: 123 }, () => null).status).toBe("invalid_input");
  });

  it("returns an explicit not-found result", () => {
    expect(resolveTenantContext({ slug: "unknown" }, () => null)).toEqual({
      status: "not_found",
    });
  });

  it("keeps tenant resolution independent from auth identity", () => {
    const result = resolveTenantContext(
      { slug: "salon-abc" },
      () => createTenantId("tenant-abc"),
    );

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.context).not.toHaveProperty("subjectId");
      expect(result.context).not.toHaveProperty("profileId");
    }
  });

  it("does not accept arbitrary tenantId as the request source", () => {
    const result = resolveTenantContext(
      { tenantId: "attacker-selected-tenant" },
      () => createTenantId("safe-tenant"),
    );

    expect(result.status).toBe("invalid_input");
  });
});
