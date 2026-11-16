import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedIdentity, createUnauthenticatedIdentity } from "../domain/auth-identity";
import type { AppointmentRecord, AppointmentStatus } from "../domain/appointment";
import type { TenantContext } from "../domain/tenant-context";
import { createAppointmentDeletion, type AppointmentDeletionRepository } from "./appointment-deletion";

const tenantContext = { tenantId: "tenant-a" as never } satisfies TenantContext;
const identity = createAuthenticatedIdentity("subject-a", "profile-a");

function appointmentWith(status: AppointmentStatus): AppointmentRecord {
  return {
    id: "appt-1", tenantId: "tenant-a", staffId: "staff-a", serviceId: "service-a", customerProfileId: "customer-a",
    startAt: new Date("2026-11-20T10:00:00.000Z"), endAt: new Date("2026-11-20T10:30:00.000Z"), status,
  };
}

function setup(options: Readonly<{
  status?: AppointmentStatus | null; admin?: boolean; assigned?: boolean;
  archive?: "archived" | "not_found" | "not_terminal";
}> = {}) {
  const status = options.status === undefined ? "CANCELLED" : options.status;
  const find = vi.fn().mockResolvedValue(status === null ? null : appointmentWith(status));
  const archive = vi.fn().mockResolvedValue(options.archive ?? "archived");
  const authorizeAdmin = vi.fn().mockResolvedValue(options.admin ?? false);
  const authorizeAssignedStaff = vi.fn().mockResolvedValue(options.assigned ?? false);
  const at = new Date("2026-11-16T12:00:00.000Z");
  const service = createAppointmentDeletion({
    repository: { find, archive } as AppointmentDeletionRepository,
    authorizer: { authorizeAdmin, authorizeAssignedStaff },
    now: () => at,
  });
  return { service, find, archive, authorizeAdmin, authorizeAssignedStaff, at };
}

describe("appointment deletion", () => {
  it("rejects unauthenticated identities before any repository call", async () => {
    const t = setup({ admin: true });
    await expect(t.service.delete(createUnauthenticatedIdentity(), tenantContext, "appt-1")).resolves.toEqual({ status: "FORBIDDEN" });
    expect(t.find).not.toHaveBeenCalled();
    expect(t.authorizeAdmin).not.toHaveBeenCalled();
  });

  it("rejects invalid ids", async () => {
    const t = setup({ admin: true });
    for (const id of [undefined, 5, "", " x", "a".repeat(101)]) {
      await expect(t.service.delete(identity, tenantContext, id)).resolves.toEqual({ status: "INVALID_INPUT" });
    }
    expect(t.find).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the appointment is missing or archived", async () => {
    const t = setup({ status: null, admin: true });
    await expect(t.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "NOT_FOUND" });
    expect(t.archive).not.toHaveBeenCalled();
  });

  it("lets an admin delete CANCELLED and COMPLETED appointments", async () => {
    for (const status of ["CANCELLED", "COMPLETED"] as const) {
      const t = setup({ status, admin: true });
      await expect(t.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "DELETED" });
      expect(t.archive).toHaveBeenCalledWith(tenantContext, "appt-1", t.at);
      expect(t.authorizeAssignedStaff).not.toHaveBeenCalled();
    }
  });

  it("requires cancellation first for active appointments", async () => {
    const t = setup({ status: "CONFIRMED", admin: true });
    await expect(t.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "MUST_CANCEL_FIRST" });
    expect(t.archive).not.toHaveBeenCalled();
  });

  it("lets the assigned staff delete a REJECTED appointment but not a COMPLETED one", async () => {
    const rejected = setup({ status: "REJECTED", assigned: true });
    await expect(rejected.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "DELETED" });
    expect(rejected.authorizeAdmin).toHaveBeenCalled();
    expect(rejected.authorizeAssignedStaff).toHaveBeenCalledWith(identity, tenantContext, appointmentWith("REJECTED"));

    const completed = setup({ status: "COMPLETED", assigned: true });
    await expect(completed.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "FORBIDDEN" });
    expect(completed.archive).not.toHaveBeenCalled();
  });

  it("forbids staff who are not assigned", async () => {
    const t = setup({ status: "CANCELLED" });
    await expect(t.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "FORBIDDEN" });
    expect(t.archive).not.toHaveBeenCalled();
  });

  it("maps a concurrent status change (not_terminal) to MUST_CANCEL_FIRST", async () => {
    const t = setup({ status: "CANCELLED", admin: true, archive: "not_terminal" });
    await expect(t.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "MUST_CANCEL_FIRST" });
  });

  it("returns NOT_FOUND on a second delete", async () => {
    const t = setup({ status: "CANCELLED", admin: true });
    await expect(t.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "DELETED" });
    t.find.mockResolvedValue(null);
    await expect(t.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "NOT_FOUND" });
    const raced = setup({ status: "CANCELLED", admin: true, archive: "not_found" });
    await expect(raced.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("maps repository failures to PERSISTENCE_FAILURE", async () => {
    const t = setup({ status: "CANCELLED", admin: true });
    t.archive.mockRejectedValue(new Error("db"));
    await expect(t.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
    const f = setup({ admin: true });
    f.find.mockRejectedValue(new Error("db"));
    await expect(f.service.delete(identity, tenantContext, "appt-1")).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
  });
});
