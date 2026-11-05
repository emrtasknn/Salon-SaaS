import { describe, expect, it, vi } from "vitest";
import { createTenantSettings } from "./tenant-settings";
import { createAuthenticatedIdentity } from "../domain/auth-identity";

const identity = createAuthenticatedIdentity("u", "p");
const tenant = { tenantId: "tenant-a" as never };
const settings = {
  name: "Salon", contactPhone: null, status: "ACTIVE" as const, timezone: "Europe/Istanbul",
  legal: { legalName: null, legalAddress: null, kvkkContactEmail: null },
  location: { publicAddress: null, mapsUrl: null },
};

function makeService(options: Readonly<{ read?: boolean; update?: boolean }> = {}) {
  const repository = {
    read: vi.fn().mockResolvedValue(settings),
    update: vi.fn().mockResolvedValue("updated"),
  };
  const authorizer = {
    authorizeRead: vi.fn().mockResolvedValue(options.read ?? true),
    authorizeUpdate: vi.fn().mockResolvedValue(options.update ?? true),
  };
  return { repository, authorizer, service: createTenantSettings({ repository, authorizer }) };
}

describe("tenant settings (WP-07)", () => {
  it("loads settings for an authorized reader", async () => {
    const { service, repository } = makeService();
    await expect(service.load(identity, tenant)).resolves.toEqual({ ok: true, settings });
    expect(repository.read).toHaveBeenCalledWith(tenant);
  });

  it("forbids load without read authorization", async () => {
    const { service, repository } = makeService({ read: false });
    await expect(service.load(identity, tenant)).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repository.read).not.toHaveBeenCalled();
  });

  it("updates only name + normalized contact phone for the context tenant", async () => {
    const { service, repository } = makeService();
    const input = { name: " Yeni Salon ", contactPhone: "0555 111 22 33", tenantId: "tenant-b", status: "INACTIVE", timezone: "UTC" };
    await expect(service.update(identity, tenant, input)).resolves.toEqual({ ok: true });
    expect(repository.update).toHaveBeenCalledWith(tenant, { name: "Yeni Salon", contactPhone: "+905551112233" });
  });

  it("clears the phone when blank", async () => {
    const { service, repository } = makeService();
    await service.update(identity, tenant, { name: "Salon", contactPhone: "" });
    expect(repository.update).toHaveBeenCalledWith(tenant, { name: "Salon", contactPhone: null });
  });

  it("forbids update when not TENANT_ADMIN (authorizer denies) before validation or writes", async () => {
    const { service, repository } = makeService({ update: false });
    await expect(service.update(identity, tenant, { name: "", contactPhone: "x" })).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: "", contactPhone: "" }, "INVALID_TENANT_NAME"],
    [{ name: "Salon", contactPhone: "abc" }, "INVALID_CONTACT_PHONE"],
  ])("rejects invalid input %j with %s", async (input, code) => {
    const { service, repository } = makeService();
    await expect(service.update(identity, tenant, input)).resolves.toEqual({ ok: false, code });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("maps repository failures to PERSISTENCE_FAILURE", async () => {
    const { service, repository } = makeService();
    repository.update.mockResolvedValueOnce("not_found");
    await expect(service.update(identity, tenant, { name: "Salon", contactPhone: "" })).resolves.toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
    repository.update.mockRejectedValueOnce(new Error("db"));
    await expect(service.update(identity, tenant, { name: "Salon", contactPhone: "" })).resolves.toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
  });
});

describe("tenant settings legal fields (WP-10)", () => {
  it("writes trimmed legal fields together with name/phone", async () => {
    const { service, repository } = makeService();
    await expect(service.update(identity, tenant, {
      name: "Salon", contactPhone: "", legalName: " Ada Ltd. ", legalAddress: "Moda Cd. 1", kvkkContactEmail: "kvkk@ada.example",
    })).resolves.toEqual({ ok: true });
    expect(repository.update).toHaveBeenCalledWith(tenant, {
      name: "Salon", contactPhone: null, legalName: "Ada Ltd.", legalAddress: "Moda Cd. 1", kvkkContactEmail: "kvkk@ada.example",
    });
  });

  it("leaves absent legal fields unchanged and clears blank ones", async () => {
    const { service, repository } = makeService();
    await service.update(identity, tenant, { name: "Salon", contactPhone: "", legalName: "" });
    expect(repository.update).toHaveBeenCalledWith(tenant, { name: "Salon", contactPhone: null, legalName: null });
  });

  it.each([
    [{ legalName: "a".repeat(201) }, "INVALID_LEGAL_NAME"],
    [{ legalAddress: "a".repeat(501) }, "INVALID_LEGAL_ADDRESS"],
    [{ kvkkContactEmail: "kvkk" }, "INVALID_KVKK_EMAIL"],
  ])("rejects %j with %s before writing", async (legal, code) => {
    const { service, repository } = makeService();
    await expect(service.update(identity, tenant, { name: "Salon", contactPhone: "", ...legal })).resolves.toEqual({ ok: false, code });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("clears tab-only / whitespace-only legal values to null (never sends a value the DB CHECK rejects)", async () => {
    const { service, repository } = makeService();
    await expect(service.update(identity, tenant, {
      name: "Salon", contactPhone: "", legalName: "\t", legalAddress: "\t\n ", kvkkContactEmail: " \t",
    })).resolves.toEqual({ ok: true });
    expect(repository.update).toHaveBeenCalledWith(tenant, {
      name: "Salon", contactPhone: null, legalName: null, legalAddress: null, kvkkContactEmail: null,
    });
  });

  it.each([
    [{ legalName: "Ada\tLtd." }, "INVALID_LEGAL_NAME"],
    [{ legalName: 42 }, "INVALID_LEGAL_NAME"],
    [{ legalAddress: { street: "Moda" } }, "INVALID_LEGAL_ADDRESS"],
    [{ kvkkContactEmail: "kv kk@ada.example" }, "INVALID_KVKK_EMAIL"],
    [{ kvkkContactEmail: "kvkk@@ada.example" }, "INVALID_KVKK_EMAIL"],
    [{ kvkkContactEmail: "@ada.example" }, "INVALID_KVKK_EMAIL"],
    [{ kvkkContactEmail: "kvkk@" }, "INVALID_KVKK_EMAIL"],
    [{ kvkkContactEmail: `${"a".repeat(243)}@example.com` }, "INVALID_KVKK_EMAIL"],
  ])("rejects %j with %s before writing", async (legal, code) => {
    const { service, repository } = makeService();
    await expect(service.update(identity, tenant, { name: "Salon", contactPhone: "", ...legal })).resolves.toEqual({ ok: false, code });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("accepts values exactly at the caps (200 / 500 / 254)", async () => {
    const { service, repository } = makeService();
    const email = `${"a".repeat(242)}@example.com`;
    expect(email).toHaveLength(254);
    await expect(service.update(identity, tenant, {
      name: "Salon", contactPhone: "", legalName: "a".repeat(200), legalAddress: "b".repeat(500), kvkkContactEmail: email,
    })).resolves.toEqual({ ok: true });
    expect(repository.update).toHaveBeenCalledOnce();
  });

  it("forbids legal updates without update authorization", async () => {
    const { service, repository } = makeService({ update: false });
    await expect(service.update(identity, tenant, { name: "Salon", contactPhone: "", legalName: "Ada" })).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe("tenant settings location fields", () => {
  it("writes the trimmed public address and the normalized maps link", async () => {
    const { service, repository } = makeService();
    await expect(service.update(identity, tenant, {
      name: "Salon", contactPhone: "", publicAddress: " Moda Cad. 12\nKadıköy ", mapsUrl: " https://maps.app.goo.gl/AbC ",
    })).resolves.toEqual({ ok: true });
    expect(repository.update).toHaveBeenCalledWith(tenant, {
      name: "Salon", contactPhone: null, publicAddress: "Moda Cad. 12, Kadıköy", mapsUrl: "https://maps.app.goo.gl/AbC",
    });
  });

  it("leaves absent location fields unchanged and clears blank ones", async () => {
    const { service, repository } = makeService();
    await service.update(identity, tenant, { name: "Salon", contactPhone: "", mapsUrl: "" });
    expect(repository.update).toHaveBeenCalledWith(tenant, { name: "Salon", contactPhone: null, mapsUrl: null });
  });

  it.each([
    [{ publicAddress: "a".repeat(301) }, "INVALID_PUBLIC_ADDRESS"],
    [{ publicAddress: "Moda\tCad." }, "INVALID_PUBLIC_ADDRESS"],
    [{ mapsUrl: "javascript:alert(1)" }, "INVALID_MAPS_URL"],
    [{ mapsUrl: "http://maps.app.goo.gl/AbC" }, "INVALID_MAPS_URL"],
    [{ mapsUrl: "https://maps.google.com.evil.com/" }, "INVALID_MAPS_URL"],
    [{ mapsUrl: "https://x@maps.google.com/" }, "INVALID_MAPS_URL"],
  ])("rejects %j with %s before writing", async (location, code) => {
    const { service, repository } = makeService();
    await expect(service.update(identity, tenant, { name: "Salon", contactPhone: "", ...location })).resolves.toEqual({ ok: false, code });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("forbids location updates without update authorization", async () => {
    const { service, repository } = makeService({ update: false });
    await expect(service.update(identity, tenant, { name: "Salon", contactPhone: "", mapsUrl: "https://maps.app.goo.gl/AbC" }))
      .resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repository.update).not.toHaveBeenCalled();
  });
});
