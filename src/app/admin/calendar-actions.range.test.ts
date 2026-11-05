import { beforeEach, describe, expect, it, vi } from "vitest";

// Calendar views (Gün | Hafta | Ay): listAdminAppointments accepts an inclusive local date range,
// validated server-side (real dates, start <= end, at most 42 days), same tenant-scoped query.
const { readAuthenticatedTenantRequest, readMembership, calendarQuery, tenantFindUnique } = vi.hoisted(() => ({
  readAuthenticatedTenantRequest: vi.fn(),
  readMembership: vi.fn(),
  calendarQuery: vi.fn(),
  tenantFindUnique: vi.fn(),
}));

vi.mock("../../infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("../../infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("../../infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({})) }));
vi.mock("../../application/auth-request-boundary", () => ({ readAuthenticatedTenantRequest }));
vi.mock("../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => ({ tenant: { findUnique: tenantFindUnique } })) }));
vi.mock("../../persistence/prisma-membership-reader", () => ({ createPrismaMembershipReader: vi.fn(() => ({ readMembership })) }));
vi.mock("../../application/calendar-crm", () => ({ createCalendarCrm: vi.fn(() => ({ calendar: calendarQuery })) }));
vi.mock("../notification-runtime", () => ({ publishAppointmentNotification: vi.fn() }));

import { listAdminAppointments } from "./calendar-actions";

const sessionTenant = { tenantId: "tenant-from-session" };

function authenticatedAs(role: string) {
  readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: { state: "authenticated", subjectId: "user-1" }, tenantContext: sessionTenant });
  readMembership.mockResolvedValue({ status: "found", membership: { profileId: "profile-1", role, tenantId: sessionTenant.tenantId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  tenantFindUnique.mockResolvedValue({ id: sessionTenant.tenantId, timezone: "Europe/Istanbul" });
  calendarQuery.mockResolvedValue({ status: "ok", appointments: [] });
});

describe("listAdminAppointments date range", () => {
  it("keeps the single-day call: 00:00–23:59 Istanbul of that day", async () => {
    authenticatedAs("TENANT_ADMIN");
    await expect(listAdminAppointments("2026-11-05")).resolves.toEqual({ status: "ok", appointments: [] });
    expect(tenantFindUnique).toHaveBeenCalledWith({ where: { id: "tenant-from-session" } });
    const [, tenantContext, range] = calendarQuery.mock.calls[0];
    expect(tenantContext).toBe(sessionTenant);
    expect(range.startAt.toISOString()).toBe("2026-11-04T21:00:00.000Z");
    expect(range.endAt.toISOString()).toBe("2026-11-05T20:59:00.000Z");
  });

  it("loads a week (Mon–Sun) with the same tenant-scoped query", async () => {
    authenticatedAs("TENANT_ADMIN");
    await listAdminAppointments("2026-11-02", "2026-11-08");
    const [, , range] = calendarQuery.mock.calls[0];
    expect(range.startAt.toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect(range.endAt.toISOString()).toBe("2026-11-08T20:59:00.000Z");
    expect(range.staffId).toBeUndefined();
  });

  it("accepts a 42-day month grid and rejects 43 days, reversed or malformed ranges", async () => {
    authenticatedAs("TENANT_ADMIN");
    await expect(listAdminAppointments("2026-10-26", "2026-12-06")).resolves.toMatchObject({ status: "ok" });
    calendarQuery.mockClear();
    const invalid: Array<[unknown, unknown]> = [
      ["2026-10-26", "2026-12-07"],
      ["2026-11-08", "2026-11-02"],
      ["2026-02-30", "2026-03-01"],
      ["2026-11-05", "not-a-date"],
      [123, "2026-11-05"],
    ];
    for (const [start, end] of invalid) {
      await expect(listAdminAppointments(start as never, end as never)).resolves.toEqual({ status: "INVALID_INPUT" });
    }
    expect(calendarQuery).not.toHaveBeenCalled();
    expect(tenantFindUnique).toHaveBeenCalledTimes(1);
  });

  it.each(["STAFF", "CUSTOMER"])("returns UNAUTHORIZED for a %s membership before validating or querying", async (role) => {
    authenticatedAs(role);
    await expect(listAdminAppointments("2026-11-02", "2026-11-08")).resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(tenantFindUnique).not.toHaveBeenCalled();
    expect(calendarQuery).not.toHaveBeenCalled();
  });
});
