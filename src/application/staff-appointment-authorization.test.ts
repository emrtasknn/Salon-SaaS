import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
import type { AppointmentRecord } from "../domain/appointment";
import type { TenantContext } from "../domain/tenant-context";
import { authorizeStaffDecision } from "./staff-appointment-authorization";

const tenantContext = { tenantId: "tenant-a" as never } satisfies TenantContext;
const identity = createAuthenticatedIdentity("subject-a", "profile-a");
const appointment = {
  id: "appointment-a",
  tenantId: "tenant-a",
  staffId: "staff-a",
  serviceId: "service-a",
  customerProfileId: "customer-a",
  startAt: new Date("2026-10-20T10:00:00.000Z"),
  endAt: new Date("2026-10-20T10:30:00.000Z"),
  status: "PENDING",
} as AppointmentRecord;

function dependencies(options: Readonly<{
  membership?: "found" | "not_found" | "error";
  role?: "STAFF" | "TENANT_ADMIN" | "SUPER_ADMIN";
  staff?: { id: string; tenantId: string; profileId: string; status: "ACTIVE" | "INACTIVE" } | null;
}> = {}) {
  const readMembership = vi.fn().mockResolvedValue(
    options.membership === "not_found"
      ? { status: "not_found" }
      : options.membership === "error"
        ? { status: "error", error: "PERSISTENCE_FAILURE" }
        : {
            status: "found",
            membership: {
              tenantId: "tenant-a",
              subjectId: "subject-a",
              profileId: "profile-a",
              role: options.role ?? "STAFF",
            },
          },
  );
  const findByProfileId = vi.fn().mockResolvedValue(
    options.staff === undefined
      ? { id: "staff-a", tenantId: "tenant-a", profileId: "profile-a", status: "ACTIVE" }
      : options.staff,
  );
  return {
    value: {
      membershipReader: { readMembership },
      staffReader: { findByProfileId },
    },
    readMembership,
    findByProfileId,
  };
}

describe("authorizeStaffDecision tenant boundary", () => {
  it("allows only the active staff member assigned to the pending appointment", async () => {
    const deps = dependencies();
    await expect(
      authorizeStaffDecision(deps.value, identity, tenantContext, appointment),
    ).resolves.toBe(true);
    expect(deps.readMembership).toHaveBeenCalledWith({
      tenantContext,
      identity,
    });
    expect(deps.findByProfileId).toHaveBeenCalledWith(tenantContext, "profile-a");
  });

  it("denies a direct appointment ID belonging to another tenant before membership lookup", async () => {
    const deps = dependencies();
    await expect(
      authorizeStaffDecision(
        deps.value,
        identity,
        tenantContext,
        { ...appointment, tenantId: "tenant-b" } as AppointmentRecord,
      ),
    ).resolves.toBe(false);
    expect(deps.readMembership).not.toHaveBeenCalled();
    expect(deps.findByProfileId).not.toHaveBeenCalled();
  });

  it("denies missing or failed tenant membership", async () => {
    for (const membership of ["not_found", "error"] as const) {
      const deps = dependencies({ membership });
      await expect(
        authorizeStaffDecision(deps.value, identity, tenantContext, appointment),
      ).resolves.toBe(false);
      expect(deps.findByProfileId).not.toHaveBeenCalled();
    }
  });

  it("denies non-staff roles and inactive staff", async () => {
    const adminMembership = dependencies({ role: "TENANT_ADMIN" });
    await expect(
      authorizeStaffDecision(adminMembership.value, identity, tenantContext, appointment),
    ).resolves.toBe(false);
    expect(adminMembership.findByProfileId).not.toHaveBeenCalled();

    const inactiveStaff = dependencies({
      staff: { id: "staff-a", tenantId: "tenant-a", profileId: "profile-a", status: "INACTIVE" },
    });
    await expect(
      authorizeStaffDecision(inactiveStaff.value, identity, tenantContext, appointment),
    ).resolves.toBe(false);
  });

  it("denies appointments assigned to another staff member or no longer pending", async () => {
    const wrongStaff = dependencies({
      staff: { id: "staff-b", tenantId: "tenant-a", profileId: "profile-a", status: "ACTIVE" },
    });
    await expect(
      authorizeStaffDecision(wrongStaff.value, identity, tenantContext, appointment),
    ).resolves.toBe(false);

    const alreadyDecided = dependencies();
    await expect(
      authorizeStaffDecision(
        alreadyDecided.value,
        identity,
        tenantContext,
        { ...appointment, status: "CONFIRMED" } as AppointmentRecord,
      ),
    ).resolves.toBe(false);
    expect(alreadyDecided.readMembership).not.toHaveBeenCalled();
  });
});
