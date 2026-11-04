import { describe, expect, it, vi } from "vitest";
import { createTenantSettings } from "./tenant-settings";
import { createAuthenticatedIdentity } from "../domain/auth-identity";

const identity = createAuthenticatedIdentity("u", "p");
const tenant = { tenantId: "tenant-a" as never };
const settings = { name: "Salon", contactPhone: null, status: "ACTIVE" as const, timezone: "Europe/Istanbul" };

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
