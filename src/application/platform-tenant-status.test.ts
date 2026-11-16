import { describe, expect, it, vi } from "vitest";
import { createPlatformTenantStatus } from "./platform-tenant-status";

const superAdmin = { kind: "SUPER_ADMIN" as const, subjectId: "platform-user" };

function makeService() {
  const repository = {
    list: vi.fn().mockResolvedValue([{ id: "t1", slug: "salon", name: "Salon", status: "ACTIVE" }]),
    setStatus: vi.fn().mockResolvedValue("updated"),
    archive: vi.fn().mockResolvedValue("archived"),
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

  it("reports a list failure instead of swallowing it, then returns PERSISTENCE_FAILURE", async () => {
    const repository = {
      list: vi.fn().mockRejectedValue(new Error("pool exhausted")),
      setStatus: vi.fn(),
      archive: vi.fn(),
    };
    const reportError = vi.fn();
    const service = createPlatformTenantStatus({ repository, reportError });
    await expect(service.list(superAdmin)).resolves.toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
    expect(reportError).toHaveBeenCalledWith("platform_tenant_list_failed", expect.any(Error));
  });

  it("still returns PERSISTENCE_FAILURE when the error reporter itself throws", async () => {
    const repository = { list: vi.fn().mockRejectedValue(new Error("down")), setStatus: vi.fn(), archive: vi.fn() };
    const reportError = vi.fn(() => {
      throw new Error("logger broken");
    });
    const service = createPlatformTenantStatus({ repository, reportError });
    await expect(service.list(superAdmin)).resolves.toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
  });

  describe("delete (tenant archive)", () => {
    const NOW = new Date("2026-11-16T10:00:00.000Z");
    function makeDeleteService(outcomes: Array<"archived" | "not_found" | "active" | "slug_mismatch">) {
      const queue = [...outcomes];
      const repository = {
        list: vi.fn(),
        setStatus: vi.fn().mockResolvedValue("not_found"),
        archive: vi.fn(async () => queue.shift() ?? "not_found"),
      };
      return { repository, service: createPlatformTenantStatus({ repository }) };
    }

    it("forbids non-super-admins without calling the repository", async () => {
      const { service, repository } = makeDeleteService(["archived"]);
      await expect(service.delete(null, { tenantId: "t1", confirmSlug: "salon-a" }, NOW)).resolves.toEqual({ status: "FORBIDDEN" });
      expect(repository.archive).not.toHaveBeenCalled();
    });

    it.each([{ tenantId: "t1", confirmSlug: 5 }, { tenantId: "t1", confirmSlug: "" }, { tenantId: "t1", confirmSlug: null }, { tenantId: " t1", confirmSlug: "s" }, { tenantId: 1, confirmSlug: "s" }])(
      "rejects invalid input %j",
      async (input) => {
        const { service, repository } = makeDeleteService(["archived"]);
        await expect(service.delete(superAdmin, input, NOW)).resolves.toEqual({ status: "INVALID_INPUT" });
        expect(repository.archive).not.toHaveBeenCalled();
      },
    );

    it("maps repository outcomes and passes the slug unmodified with the injected time", async () => {
      const { service, repository } = makeDeleteService(["active", "slug_mismatch", "slug_mismatch", "archived", "not_found"]);
      await expect(service.delete(superAdmin, { tenantId: "t1", confirmSlug: "salon-a" }, NOW)).resolves.toEqual({ status: "TENANT_ACTIVE" });
      await expect(service.delete(superAdmin, { tenantId: "t1", confirmSlug: "Salon-A" }, NOW)).resolves.toEqual({ status: "CONFIRMATION_MISMATCH" });
      await expect(service.delete(superAdmin, { tenantId: "t1", confirmSlug: " salon-a" }, NOW)).resolves.toEqual({ status: "CONFIRMATION_MISMATCH" });
      await expect(service.delete(superAdmin, { tenantId: "t1", confirmSlug: "salon-a" }, NOW)).resolves.toEqual({ status: "DELETED" });
      await expect(service.delete(superAdmin, { tenantId: "t1", confirmSlug: "salon-a" }, NOW)).resolves.toEqual({ status: "NOT_FOUND" });
      expect(repository.archive).toHaveBeenNthCalledWith(2, "t1", "Salon-A", NOW);
      expect(repository.archive).toHaveBeenNthCalledWith(3, "t1", " salon-a", NOW);
    });

    it("maps a thrown repository error to PERSISTENCE_FAILURE", async () => {
      const { service, repository } = makeDeleteService([]);
      repository.archive.mockRejectedValueOnce(new Error("down"));
      await expect(service.delete(superAdmin, { tenantId: "t1", confirmSlug: "salon-a" }, NOW)).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
    });
  });

  it("maps a missing tenant to NOT_FOUND and failures to PERSISTENCE_FAILURE", async () => {
    const { service, repository } = makeService();
    repository.setStatus.mockResolvedValueOnce("not_found");
    await expect(service.setStatus(superAdmin, { tenantId: "missing", status: "ACTIVE" })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    repository.setStatus.mockResolvedValueOnce("persistence_failure");
    await expect(service.setStatus(superAdmin, { tenantId: "t1", status: "ACTIVE" })).resolves.toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
  });
});
