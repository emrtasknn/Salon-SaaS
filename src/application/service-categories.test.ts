import { describe, expect, it, vi } from "vitest";
import { createServiceCategoryManager } from "./service-categories";
import type { TenantContext } from "../domain/tenant-context";
import type { ApplicationIdentity } from "../domain/auth-identity";

const tenantContext = { tenantId: "tenant-1" } as TenantContext;
const identity: ApplicationIdentity = { state: "authenticated", subjectId: "subject-1" as never, profileId: "profile-1" };

function deps(allowed = true) {
  return {
    authorizer: { authorize: vi.fn().mockResolvedValue(allowed) },
    repository: {
      list: vi.fn().mockResolvedValue([{ id: "c1", tenantId: "tenant-1", name: "Saç", sortOrder: 1 }]),
      create: vi.fn().mockResolvedValue("created"),
      rename: vi.fn().mockResolvedValue("updated"),
      move: vi.fn().mockResolvedValue("updated"),
      remove: vi.fn().mockResolvedValue("deleted"),
    },
  };
}

describe("service categories (owner decision 2026-11-06)", () => {
  it("requires TENANT_ADMIN for every operation and never touches the repository otherwise", async () => {
    const d = deps(false);
    const manager = createServiceCategoryManager(d);
    expect(await manager.list(identity, tenantContext)).toEqual({ status: "UNAUTHORIZED" });
    expect(await manager.create(identity, tenantContext, "Saç")).toEqual({ status: "UNAUTHORIZED" });
    expect(await manager.rename(identity, tenantContext, "c1", "Saç")).toEqual({ status: "UNAUTHORIZED" });
    expect(await manager.move(identity, tenantContext, "c1", "up")).toEqual({ status: "UNAUTHORIZED" });
    expect(await manager.remove(identity, tenantContext, "c1")).toEqual({ status: "UNAUTHORIZED" });
    for (const fn of Object.values(d.repository)) expect(fn).not.toHaveBeenCalled();
    expect(d.authorizer.authorize).toHaveBeenCalledWith(identity, tenantContext, "TENANT_ADMIN");
  });

  it("lists categories", async () => {
    const result = await createServiceCategoryManager(deps()).list(identity, tenantContext);
    expect(result).toEqual({ status: "listed", categories: [{ id: "c1", tenantId: "tenant-1", name: "Saç", sortOrder: 1 }] });
  });

  it("creates with a normalized name and reports duplicates", async () => {
    const d = deps();
    expect(await createServiceCategoryManager(d).create(identity, tenantContext, "  Saç ")).toEqual({ status: "created" });
    expect(d.repository.create).toHaveBeenCalledWith(tenantContext, "Saç");
    d.repository.create.mockResolvedValue("conflict");
    expect(await createServiceCategoryManager(d).create(identity, tenantContext, "Saç")).toEqual({ status: "CONFLICT" });
  });

  it("validates names and ids before persistence", async () => {
    const d = deps();
    const manager = createServiceCategoryManager(d);
    expect(await manager.create(identity, tenantContext, "  ")).toEqual({ status: "INVALID_INPUT" });
    expect(await manager.rename(identity, tenantContext, "", "Saç")).toEqual({ status: "INVALID_INPUT" });
    expect(await manager.move(identity, tenantContext, "c1", "sideways")).toEqual({ status: "INVALID_INPUT" });
    expect(await manager.remove(identity, tenantContext, "a\nb")).toEqual({ status: "INVALID_INPUT" });
    expect(d.repository.create).not.toHaveBeenCalled();
    expect(d.repository.remove).not.toHaveBeenCalled();
  });

  it("renames, moves and removes, mapping not_found", async () => {
    const d = deps();
    const manager = createServiceCategoryManager(d);
    expect(await manager.rename(identity, tenantContext, "c1", "Saç bakımı")).toEqual({ status: "updated" });
    expect(d.repository.rename).toHaveBeenCalledWith(tenantContext, "c1", "Saç bakımı");
    expect(await manager.move(identity, tenantContext, "c1", "down")).toEqual({ status: "updated" });
    expect(await manager.remove(identity, tenantContext, "c1")).toEqual({ status: "deleted" });
    d.repository.remove.mockResolvedValue("not_found");
    expect(await manager.remove(identity, tenantContext, "c1")).toEqual({ status: "NOT_FOUND" });
  });

  it("turns repository errors into PERSISTENCE_FAILURE", async () => {
    const d = deps();
    d.repository.list.mockRejectedValue(new Error("db down"));
    expect(await createServiceCategoryManager(d).list(identity, tenantContext)).toEqual({ status: "PERSISTENCE_FAILURE" });
  });
});
