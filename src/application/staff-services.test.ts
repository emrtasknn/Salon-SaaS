import { describe, expect, it, vi } from "vitest";
import { createStaffServiceManager } from "./staff-services";

const identity = { kind: "authenticated" } as never;
const tenantContext = { tenantId: "tenant-a" } as never;

function make(allowed = true) {
  const repository = { list: vi.fn().mockResolvedValue(new Map([["staff-a", ["svc-1"]]])), replace: vi.fn().mockResolvedValue("updated") };
  const authorizer = { authorize: vi.fn().mockResolvedValue(allowed) };
  return { manager: createStaffServiceManager({ authorizer, repository }), repository, authorizer };
}

describe("staff service manager (owner decision 2026-11-06)", () => {
  it("requires TENANT_ADMIN for list and set, before touching the repository", async () => {
    const { manager, repository, authorizer } = make(false);
    await expect(manager.list(identity, tenantContext)).resolves.toEqual({ status: "UNAUTHORIZED" });
    await expect(manager.set(identity, tenantContext, "staff-a", [])).resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(authorizer.authorize).toHaveBeenCalledWith(identity, tenantContext, "TENANT_ADMIN");
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.replace).not.toHaveBeenCalled();
  });

  it("lists the mapping as a plain object", async () => {
    await expect(make().manager.list(identity, tenantContext)).resolves.toEqual({ status: "listed", byStaff: { "staff-a": ["svc-1"] } });
  });

  it("de-duplicates ids and passes [] through as \"every service\"", async () => {
    const { manager, repository } = make();
    await expect(manager.set(identity, tenantContext, "staff-a", ["svc-1", "svc-1", "svc-2"])).resolves.toEqual({ status: "updated" });
    expect(repository.replace).toHaveBeenCalledWith(tenantContext, "staff-a", ["svc-1", "svc-2"]);
    await manager.set(identity, tenantContext, "staff-a", []);
    expect(repository.replace).toHaveBeenLastCalledWith(tenantContext, "staff-a", []);
  });

  it("rejects malformed input without a repository call", async () => {
    const { manager, repository } = make();
    for (const [staffId, ids] of [["", []], ["staff-a", "svc-1"], ["staff-a", [1]], ["staff-a", [" svc"]], ["staff-a", Array(201).fill("x")]] as const) {
      await expect(manager.set(identity, tenantContext, staffId, ids)).resolves.toEqual({ status: "INVALID_INPUT" });
    }
    expect(repository.replace).not.toHaveBeenCalled();
  });

  it("maps repository outcomes", async () => {
    const { manager, repository } = make();
    repository.replace.mockResolvedValueOnce("not_found").mockResolvedValueOnce("invalid_service").mockRejectedValueOnce(new Error("db"));
    await expect(manager.set(identity, tenantContext, "staff-x", [])).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(manager.set(identity, tenantContext, "staff-a", ["svc-9"])).resolves.toEqual({ status: "INVALID_INPUT" });
    await expect(manager.set(identity, tenantContext, "staff-a", [])).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
  });
});
