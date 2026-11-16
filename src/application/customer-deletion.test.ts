import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedIdentity, createUnauthenticatedIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import { createCustomerDeletion, type CustomerDeletionRepository } from "./customer-deletion";

const tenantContext = { tenantId: "tenant-a" as never } satisfies TenantContext;
const identity = createAuthenticatedIdentity("subject-a", "profile-a");
const at = new Date("2026-11-16T12:00:00.000Z");

type EraseResult = Awaited<ReturnType<CustomerDeletionRepository["erase"]>>;
type NoteResult = Awaited<ReturnType<CustomerDeletionRepository["deleteNote"]>>;

function setup(options: Readonly<{ admin?: boolean; erase?: EraseResult; note?: NoteResult; throws?: boolean }> = {}) {
  const erase = options.throws
    ? vi.fn().mockRejectedValue(new Error("db"))
    : vi.fn().mockResolvedValue(options.erase ?? "erased");
  const deleteNote = options.throws
    ? vi.fn().mockRejectedValue(new Error("db"))
    : vi.fn().mockResolvedValue(options.note ?? "deleted");
  const authorizeAdmin = vi.fn().mockResolvedValue(options.admin ?? true);
  const service = createCustomerDeletion({ repository: { erase, deleteNote }, authorizer: { authorizeAdmin }, now: () => at });
  return { service, erase, deleteNote, authorizeAdmin };
}

describe("customer deletion", () => {
  it("rejects unauthenticated identities and non-admins with FORBIDDEN for both operations", async () => {
    const anon = setup();
    await expect(anon.service.deleteCustomer(createUnauthenticatedIdentity(), tenantContext, "c1")).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(anon.service.deleteNote(createUnauthenticatedIdentity(), tenantContext, "n1")).resolves.toEqual({ status: "FORBIDDEN" });
    const nonAdmin = setup({ admin: false });
    await expect(nonAdmin.service.deleteCustomer(identity, tenantContext, "c1")).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(nonAdmin.service.deleteNote(identity, tenantContext, "n1")).resolves.toEqual({ status: "FORBIDDEN" });
    for (const t of [anon, nonAdmin]) {
      expect(t.erase).not.toHaveBeenCalled();
      expect(t.deleteNote).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid ids", async () => {
    const t = setup();
    for (const bad of ["", " c1", 5, null, "a".repeat(101)]) {
      await expect(t.service.deleteCustomer(identity, tenantContext, bad)).resolves.toEqual({ status: "INVALID_INPUT" });
      await expect(t.service.deleteNote(identity, tenantContext, bad)).resolves.toEqual({ status: "INVALID_INPUT" });
    }
    expect(t.erase).not.toHaveBeenCalled();
    expect(t.deleteNote).not.toHaveBeenCalled();
  });

  it("erases with injected now", async () => {
    const t = setup();
    await expect(t.service.deleteCustomer(identity, tenantContext, "c1")).resolves.toEqual({ status: "DELETED" });
    expect(t.erase).toHaveBeenCalledWith(tenantContext, { profileId: "c1", now: at });
  });

  it.each([
    ["not_found", { status: "NOT_FOUND" }],
    ["not_customer", { status: "NOT_DELETABLE" }],
  ] as const)("maps erase %s", async (erase, expected) => {
    await expect(setup({ erase }).service.deleteCustomer(identity, tenantContext, "c1")).resolves.toEqual(expected);
  });

  it("maps has_active_appointments with count", async () => {
    const t = setup({ erase: { status: "has_active_appointments", count: 2 } });
    await expect(t.service.deleteCustomer(identity, tenantContext, "c1")).resolves.toEqual({ status: "HAS_ACTIVE_APPOINTMENTS", count: 2 });
  });

  it("a second delete of the same customer resolves NOT_FOUND", async () => {
    const erase = vi.fn().mockResolvedValueOnce("erased").mockResolvedValueOnce("not_found");
    const service = createCustomerDeletion({
      repository: { erase, deleteNote: vi.fn() }, authorizer: { authorizeAdmin: vi.fn().mockResolvedValue(true) }, now: () => at,
    });
    await expect(service.deleteCustomer(identity, tenantContext, "c1")).resolves.toEqual({ status: "DELETED" });
    await expect(service.deleteCustomer(identity, tenantContext, "c1")).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("deletes a note and maps not_found, including a double delete", async () => {
    const t = setup();
    await expect(t.service.deleteNote(identity, tenantContext, "n1")).resolves.toEqual({ status: "DELETED" });
    expect(t.deleteNote).toHaveBeenCalledWith(tenantContext, "n1");
    const deleteNote = vi.fn().mockResolvedValueOnce("deleted").mockResolvedValueOnce("not_found");
    const service = createCustomerDeletion({
      repository: { erase: vi.fn(), deleteNote }, authorizer: { authorizeAdmin: vi.fn().mockResolvedValue(true) },
    });
    await expect(service.deleteNote(identity, tenantContext, "n1")).resolves.toEqual({ status: "DELETED" });
    await expect(service.deleteNote(identity, tenantContext, "n1")).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("maps repository errors to PERSISTENCE_FAILURE", async () => {
    const t = setup({ throws: true });
    await expect(t.service.deleteCustomer(identity, tenantContext, "c1")).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
    await expect(t.service.deleteNote(identity, tenantContext, "n1")).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
  });
});
