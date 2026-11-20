import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedIdentity, createUnauthenticatedIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import { createServiceDeletion, type ServiceDeletionRepository } from "./service-deletion";

const tenantContext = { tenantId: "tenant-a" as never } satisfies TenantContext;
const identity = createAuthenticatedIdentity("subject-a", "profile-a");
const at = new Date("2026-11-16T12:00:00.000Z");

type ArchiveResult = Awaited<ReturnType<ServiceDeletionRepository["archive"]>>;

function setup(options: Readonly<{ admin?: boolean; archive?: ArchiveResult; throws?: boolean }> = {}) {
  const archive = options.throws
    ? vi.fn().mockRejectedValue(new Error("db"))
    : vi.fn().mockResolvedValue(options.archive ?? "archived");
  const authorizeAdmin = vi.fn().mockResolvedValue(options.admin ?? true);
  const service = createServiceDeletion({ repository: { archive }, authorizer: { authorizeAdmin }, now: () => at });
  return { service, archive, authorizeAdmin };
}

describe("service deletion", () => {
  it("rejects unauthenticated identities and non-admins with FORBIDDEN", async () => {
    const anon = setup();
    await expect(anon.service.delete(createUnauthenticatedIdentity(), tenantContext, "s1")).resolves.toEqual({ status: "FORBIDDEN" });
    expect(anon.archive).not.toHaveBeenCalled();
    const nonAdmin = setup({ admin: false });
    await expect(nonAdmin.service.delete(identity, tenantContext, "s1")).resolves.toEqual({ status: "FORBIDDEN" });
    expect(nonAdmin.archive).not.toHaveBeenCalled();
  });

  it("rejects invalid ids", async () => {
    const t = setup();
    for (const bad of ["", " s1", 5, null, "a".repeat(101)]) {
      await expect(t.service.delete(identity, tenantContext, bad)).resolves.toEqual({ status: "INVALID_INPUT" });
    }
    expect(t.archive).not.toHaveBeenCalled();
  });

  it("archives with the injected now", async () => {
    const t = setup();
    await expect(t.service.delete(identity, tenantContext, "s1")).resolves.toEqual({ status: "DELETED" });
    expect(t.archive).toHaveBeenCalledWith(tenantContext, { serviceId: "s1", now: at });
  });

  it("maps not_found", async () => {
    await expect(setup({ archive: "not_found" }).service.delete(identity, tenantContext, "s1")).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("maps has_active_appointments with count", async () => {
    const t = setup({ archive: { status: "has_active_appointments", count: 3 } });
    await expect(t.service.delete(identity, tenantContext, "s1")).resolves.toEqual({ status: "HAS_ACTIVE_APPOINTMENTS", count: 3 });
  });

  it("maps repository errors to PERSISTENCE_FAILURE", async () => {
    await expect(setup({ throws: true }).service.delete(identity, tenantContext, "s1")).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
  });
});
