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
      active: false, whatsAppUrl: "https://wa.me/905551112233", legalReady: false, location: null, services: [], staff: [], workingHours: [],
    });
    expect(repository.catalog).not.toHaveBeenCalled();
  });

  it("exposes only a legalReady boolean, never the raw legal fields (WP-10)", async () => {
    const legal = { legalName: "Ada Güzellik Ltd. Şti.", legalAddress: "Moda Cd. 1, Kadıköy", kvkkContactEmail: "kvkk@ada.example" };
    const repository = {
      resolveBySlug: vi.fn().mockResolvedValue({ tenantContext: { tenantId: "t" }, name: "Salon", timezone: "Europe/Istanbul", status: "ACTIVE", contactPhone: null, ...legal }),
      catalog: vi.fn().mockResolvedValue({ services: [], staff: [], workingHours: [] }),
    };
    const ready = await createPublicVitrin(repository).load("salon");
    expect(ready).toMatchObject({ status: "ok", legalReady: true });
    for (const key of Object.keys(legal)) expect(ready).not.toHaveProperty(key);
    repository.resolveBySlug.mockResolvedValue({ tenantContext: { tenantId: "t" }, name: "Salon", timezone: "Europe/Istanbul", status: "ACTIVE", contactPhone: null, ...legal, kvkkContactEmail: null });
    await expect(createPublicVitrin(repository).load("salon")).resolves.toMatchObject({ legalReady: false });
  });

  it("exposes only the public address + a safe directions link, never the raw maps link", async () => {
    const base = { tenantContext: { tenantId: "t" }, name: "Salon", timezone: "Europe/Istanbul", status: "ACTIVE", contactPhone: null };
    const repository = {
      resolveBySlug: vi.fn().mockResolvedValue({ ...base, publicAddress: "Moda Cad. 12", mapsUrl: "https://maps.app.goo.gl/AbC" }),
      catalog: vi.fn().mockResolvedValue({ services: [], staff: [], workingHours: [] }),
    };
    const withLink = await createPublicVitrin(repository).load("salon");
    expect(withLink).toMatchObject({ location: { address: "Moda Cad. 12", directionsUrl: "https://maps.app.goo.gl/AbC" } });
    expect(withLink).not.toHaveProperty("mapsUrl");
    expect(withLink).not.toHaveProperty("publicAddress");

    repository.resolveBySlug.mockResolvedValue({ ...base, publicAddress: "Moda Cad. 12", mapsUrl: "https://evil.com/" });
    await expect(createPublicVitrin(repository).load("salon")).resolves.toMatchObject({
      location: { address: "Moda Cad. 12", directionsUrl: "https://www.google.com/maps/search/?api=1&query=Moda%20Cad.%2012" },
    });

    repository.resolveBySlug.mockResolvedValue({ ...base, publicAddress: null, mapsUrl: "https://maps.app.goo.gl/AbC" });
    await expect(createPublicVitrin(repository).load("salon")).resolves.toMatchObject({
      location: { address: null, directionsUrl: "https://maps.app.goo.gl/AbC" },
    });

    repository.resolveBySlug.mockResolvedValue({ ...base, publicAddress: null, mapsUrl: null });
    await expect(createPublicVitrin(repository).load("salon")).resolves.toMatchObject({ location: null });
  });
});
