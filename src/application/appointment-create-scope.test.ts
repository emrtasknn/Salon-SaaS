import { describe, expect, it, vi } from "vitest";
import { resolveAppointmentCreateScope } from "./appointment-create-scope";
import { createAuthenticatedIdentity } from "../domain/auth-identity";

const tenant = { tenantId: "t" as never };
const identity = createAuthenticatedIdentity("u", "p");

function deps(input: { admin: boolean; role?: string; staff?: unknown }) {
  return {
    authorizeAdmin: vi.fn().mockResolvedValue(input.admin),
    membershipReader: { readMembership: vi.fn().mockResolvedValue(input.role ? { status: "found", membership: { role: input.role, profileId: "p" } } : { status: "not_found" }) },
    staffReader: { findByProfileId: vi.fn().mockResolvedValue(input.staff ?? null) },
  };
}

describe("resolveAppointmentCreateScope (WP-08)", () => {
  it("admin (TENANT_ADMIN or higher) -> admin scope", async () => {
    await expect(resolveAppointmentCreateScope(deps({ admin: true }), identity, tenant)).resolves.toEqual({ kind: "admin" });
  });

  it("ACTIVE staff -> own staffId read from the server", async () => {
    const d = deps({ admin: false, role: "STAFF", staff: { id: "s1", tenantId: "t", profileId: "p", status: "ACTIVE" } });
    await expect(resolveAppointmentCreateScope(d, identity, tenant)).resolves.toEqual({ kind: "staff", staffId: "s1" });
    expect(d.staffReader.findByProfileId).toHaveBeenCalledWith(tenant, "p");
  });

  it("inactive or foreign staff, CUSTOMER, non-members and anonymous -> null", async () => {
    await expect(resolveAppointmentCreateScope(deps({ admin: false, role: "STAFF", staff: { id: "s1", tenantId: "t", profileId: "p", status: "INACTIVE" } }), identity, tenant)).resolves.toBeNull();
    await expect(resolveAppointmentCreateScope(deps({ admin: false, role: "STAFF", staff: { id: "s1", tenantId: "other", profileId: "p", status: "ACTIVE" } }), identity, tenant)).resolves.toBeNull();
    await expect(resolveAppointmentCreateScope(deps({ admin: false, role: "STAFF" }), identity, tenant)).resolves.toBeNull();
    await expect(resolveAppointmentCreateScope(deps({ admin: false, role: "CUSTOMER" }), identity, tenant)).resolves.toBeNull();
    await expect(resolveAppointmentCreateScope(deps({ admin: false }), identity, tenant)).resolves.toBeNull();
    const d = deps({ admin: true });
    await expect(resolveAppointmentCreateScope(d, { state: "unauthenticated" }, tenant)).resolves.toBeNull();
    expect(d.authorizeAdmin).not.toHaveBeenCalled();
  });
});
