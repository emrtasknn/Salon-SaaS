import { describe, expect, it, vi } from "vitest";
import { createPlatformTenantStatus } from "./platform-tenant-status";

const superAdmin = { kind: "SUPER_ADMIN" as const, subjectId: "platform-user" };

function makeService() {
  const repository = {
    list: vi.fn().mockResolvedValue([{ id: "t1", slug: "salon", name: "Salon", status: "ACTIVE" }]),
    setStatus: vi.fn().mockResolvedValue("updated"),
  };
  return { repository, service: createPlatformTenantStatus({ repository }) };
}

describe("platform tenant status (WP-07)", () => {
  it("lists tenants for SUPER_ADMIN only", async () => {
    const { service, repository } = makeService();
    await expect(service.list(superAdmin)).resolves.toEqual({ ok: true, tenants: [{ id: "t1", slug: "salon", name: "Salon", status: "ACTIVE" }] });
    await expect(service.list(null)).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repository.list).toHaveBeenCalledOnce();
  });

  it("sets a valid status for an existing tenant", async () => {
    const { service, repository } = makeService();
    await expect(service.setStatus(superAdmin, { tenantId: "t1", status: "INACTIVE" })).resolves.toEqual({ ok: true });
    expect(repository.setStatus).toHaveBeenCalledWith("t1", "INACTIVE");
  });

  it("forbids non-platform callers (e.g. a TENANT_ADMIN session) without writing", async () => {
    const { service, repository } = makeService();
    await expect(service.setStatus(null, { tenantId: "t1", status: "INACTIVE" })).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repository.setStatus).not.toHaveBeenCalled();
  });

  it.each([
    { tenantId: "t1", status: "inactive" },
    { tenantId: "t1", status: "DELETED" },
    { tenantId: "t1", status: null },
    { tenantId: "", status: "ACTIVE" },
    { tenantId: " t1", status: "ACTIVE" },
    { tenantId: "t\u0000", status: "ACTIVE" },
    { tenantId: "x".repeat(101), status: "ACTIVE" },
    { tenantId: 42, status: "ACTIVE" },
  ])("rejects invalid input %j", async (input) => {
    const { service, repository } = makeService();
    await expect(service.setStatus(superAdmin, input)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(repository.setStatus).not.toHaveBeenCalled();
  });

  it("maps a missing tenant to NOT_FOUND and failures to PERSISTENCE_FAILURE", async () => {
    const { service, repository } = makeService();
    repository.setStatus.mockResolvedValueOnce("not_found");
    await expect(service.setStatus(superAdmin, { tenantId: "missing", status: "ACTIVE" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    repository.setStatus.mockResolvedValueOnce("persistence_failure");
    await expect(service.setStatus(superAdmin, { tenantId: "t1", status: "ACTIVE" })).resolves.toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
  });
});
