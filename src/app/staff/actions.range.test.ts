import { beforeEach, describe, expect, it, vi } from "vitest";

// Calendar views (Gün | Hafta | Ay): listStaffAppointments accepts an inclusive local date range,
// validated server-side (max 42 days); the staffId is always the signed-in staff member's own row.
const { readAuthenticatedTenantRequest, readMembership, findStaffByProfileId, listForStaff, tenantFindUnique } = vi.hoisted(() => ({
  readAuthenticatedTenantRequest: vi.fn(),
  readMembership: vi.fn(),
  findStaffByProfileId: vi.fn(),
  listForStaff: vi.fn(),
  tenantFindUnique: vi.fn(),
}));

vi.mock("../../infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("../../infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("../../infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({})) }));
vi.mock("../../application/auth-request-boundary", () => ({ readAuthenticatedTenantRequest }));
vi.mock("../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => ({ tenant: { findUnique: tenantFindUnique } })) }));
vi.mock("../../persistence/prisma-membership-reader", () => ({ createPrismaMembershipReader: vi.fn(() => ({ readMembership })) }));
vi.mock("../../persistence/prisma-staff-lookup", () => ({ findStaffByProfileId }));
vi.mock("../../application/staff-appointments", () => ({ createStaffAppointments: vi.fn(() => ({ list: listForStaff })) }));
vi.mock("../notification-runtime", () => ({ publishAppointmentNotification: vi.fn() }));

import { listStaffAppointments } from "./actions";

const sessionTenant = { tenantId: "tenant-from-session" };

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: { state: "authenticated", subjectId: "user-1" }, tenantContext: sessionTenant });
  readMembership.mockResolvedValue({ status: "found", membership: { profileId: "profile-1", role: "STAFF", tenantId: sessionTenant.tenantId } });
  findStaffByProfileId.mockResolvedValue({ id: "own-staff", tenantId: sessionTenant.tenantId, status: "ACTIVE" });
  tenantFindUnique.mockResolvedValue({ id: sessionTenant.tenantId, timezone: "Europe/Istanbul" });
  listForStaff.mockResolvedValue({ status: "ok", appointments: [] });
});

describe("listStaffAppointments date range", () => {
  it("loads a week for the signed-in staff member only", async () => {
    await expect(listStaffAppointments("2026-11-02", "2026-11-08")).resolves.toEqual({ status: "ok", appointments: [] });
    const [, tenantContext, staffId, range] = listForStaff.mock.calls[0];
    expect(tenantContext).toBe(sessionTenant);
    expect(staffId).toBe("own-staff");
    expect(range.startAt.toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect(range.endAt.toISOString()).toBe("2026-11-08T20:59:00.000Z");
  });

  it("keeps the single-day call", async () => {
    await listStaffAppointments("2026-11-05");
    const [, , , range] = listForStaff.mock.calls[0];
    expect(range.startAt.toISOString()).toBe("2026-11-04T21:00:00.000Z");
    expect(range.endAt.toISOString()).toBe("2026-11-05T20:59:00.000Z");
  });

  it("rejects ranges over 42 days, reversed or malformed", async () => {
    const invalid: Array<[unknown, unknown]> = [
      ["2026-10-26", "2026-12-07"],
      ["2026-11-08", "2026-11-02"],
      ["2026-13-01", "2026-13-02"],
      ["2026-11-05", 5],
    ];
    for (const [start, end] of invalid) {
      await expect(listStaffAppointments(start as never, end as never)).resolves.toEqual({ status: "INVALID_INPUT" });
    }
    expect(listForStaff).not.toHaveBeenCalled();
  });

  it("returns UNAUTHORIZED when the staff row is inactive", async () => {
    findStaffByProfileId.mockResolvedValue({ id: "own-staff", tenantId: sessionTenant.tenantId, status: "INACTIVE" });
    await expect(listStaffAppointments("2026-11-02", "2026-11-08")).resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(listForStaff).not.toHaveBeenCalled();
  });
});
