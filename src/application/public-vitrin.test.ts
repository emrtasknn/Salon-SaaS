import { describe, expect, it, vi } from "vitest";
import { createPublicVitrin } from "./public-vitrin";

describe("public vitrin", () => {
  it("resolves the tenant by slug before reading catalog data", async () => {
    const repository = {
      resolveBySlug: vi.fn().mockResolvedValue({ tenantContext: { tenantId: "t" }, name: "Salon", timezone: "Europe/Istanbul", status: "ACTIVE", contactPhone: null }),
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

  it("exposes active + derived wa.me URL but never the raw status or phone (WP-07)", async () => {
    const repository = {
      resolveBySlug: vi.fn().mockResolvedValue({ tenantContext: { tenantId: "t" }, name: "Salon", timezone: "Europe/Istanbul", status: "ACTIVE", contactPhone: "+905551112233" }),
      catalog: vi.fn().mockResolvedValue({ services: [{ id: "svc" }], staff: [], workingHours: [] }),
    };
    const result = await createPublicVitrin(repository).load("salon");
    expect(result).toMatchObject({ status: "ok", active: true, whatsAppUrl: "https://wa.me/905551112233", services: [{ id: "svc" }] });
    expect(result).not.toHaveProperty("contactPhone");
    expect(JSON.stringify(result)).not.toContain("+905551112233");
  });

  it("returns an inactive salon with name + wa.me but no catalog (WP-07)", async () => {
    const repository = {
      resolveBySlug: vi.fn().mockResolvedValue({ tenantContext: { tenantId: "t" }, name: "Salon", timezone: "Europe/Istanbul", status: "INACTIVE", contactPhone: "+905551112233" }),
      catalog: vi.fn(),
    };
    const result = await createPublicVitrin(repository).load("salon");
    expect(result).toEqual({
      status: "ok", tenantContext: { tenantId: "t" }, name: "Salon", timezone: "Europe/Istanbul",
      active: false, whatsAppUrl: "https://wa.me/905551112233", services: [], staff: [], workingHours: [],
    });
    expect(repository.catalog).not.toHaveBeenCalled();
  });
});
