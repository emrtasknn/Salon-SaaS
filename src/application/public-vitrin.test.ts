import { describe, expect, it, vi } from "vitest";
import { createPublicVitrin } from "./public-vitrin";

describe("public vitrin", () => {
  it("resolves the tenant by slug before reading catalog data", async () => {
    const repository = {
      resolveBySlug: vi.fn().mockResolvedValue({ tenantContext: { tenantId: "t" }, name: "Salon", timezone: "Europe/Istanbul" }),
      catalog: vi.fn().mockResolvedValue({ services: [], staff: [], workingHours: [] }),
    };
    const result = await createPublicVitrin(repository).load("Salon");
    expect(result.status).toBe("ok");
    expect(repository.catalog).toHaveBeenCalledWith({ tenantId: "t" });
  });

  it("fails closed for an unknown tenant", async () => {
    const repository = { resolveBySlug: vi.fn().mockResolvedValue(null), catalog: vi.fn() };
    await expect(createPublicVitrin(repository).load("missing")).resolves.toEqual({ status: "NOT_FOUND" });
    expect(repository.catalog).not.toHaveBeenCalled();
  });
});
