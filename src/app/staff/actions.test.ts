import { beforeEach, describe, expect, it, vi } from "vitest";

// WP-08 QA: staff create-appointment actions. Tenant comes from the session only; staffId is the
// signed-in staff member's own row (decision e) and any client-supplied staffId/tenantId is ignored.
const { readAuthenticatedTenantRequest, readMembership, staffFindUnique, setTenantConfig, runtime, prisma } = vi.hoisted(() => {
  const staffFindUnique = vi.fn();
  const setTenantConfig = vi.fn();
  return {
    readAuthenticatedTenantRequest: vi.fn(),
    readMembership: vi.fn(),
    staffFindUnique,
    setTenantConfig,
    runtime: {
      createOnBehalfBookingEngine: vi.fn(() => ({ marker: "engine" })),
      createOnBehalf: vi.fn(),
      listSlotsOnBehalf: vi.fn(),
      readCreateOptions: vi.fn(),
    },
    // The staff lookup runs inside withPrismaTenantContext (RLS-safe under a NOBYPASSRLS role).
    prisma: {
      $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
        operation({ $executeRaw: setTenantConfig, staff: { findUnique: staffFindUnique } })),
    },
  };
});

vi.mock("../../infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("../../infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("../../infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({})) }));
vi.mock("../../application/auth-request-boundary", () => ({ readAuthenticatedTenantRequest }));
vi.mock("../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => prisma) }));
vi.mock("../../persistence/prisma-membership-reader", () => ({ createPrismaMembershipReader: vi.fn(() => ({ readMembership })) }));
vi.mock("../notification-runtime", () => ({ publishAppointmentNotification: vi.fn() }));
vi.mock("../appointment-create-runtime", () => runtime);

import { createStaffAppointment, getStaffCreateOptions, listStaffSlots } from "./actions";

const sessionTenant = { tenantId: "tenant-from-session" };
const input = {
  serviceId: "svc",
  startAt: "2026-11-09T06:00:00.000Z",
  customer: { kind: "guest" as const, displayName: "Guest", phone: "+905551112233" },
  notifyCustomer: true,
  whatsappVerbalOptIn: false,
};
const ownStaff = { id: "own-staff", tenantId: sessionTenant.tenantId, profileId: "profile-1", status: "ACTIVE" };

function authenticatedAs(role: string, staff: unknown = ownStaff) {
  readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: { state: "authenticated", subjectId: "user-1" }, tenantContext: sessionTenant });
  readMembership.mockResolvedValue({ status: "found", membership: { profileId: "profile-1", role, tenantId: sessionTenant.tenantId } });
  staffFindUnique.mockResolvedValue(staff);
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.createOnBehalf.mockResolvedValue({ status: "CREATED", appointmentId: "a1", notified: true });
  runtime.listSlotsOnBehalf.mockResolvedValue({ status: "OK", slots: [] });
  runtime.readCreateOptions.mockResolvedValue({ timezone: "Europe/Istanbul", services: [], staff: [] });
});

describe("createStaffAppointment (WP-08)", () => {
  it("uses the session tenant and the server-derived own staffId, ignoring client staffId/tenantId", async () => {
    authenticatedAs("STAFF");
    const result = await createStaffAppointment({ ...input, staffId: "other-staff", tenantId: "tenant-from-client" } as never);
    expect(result).toEqual({ status: "CREATED", appointmentId: "a1", notified: true });
    expect(staffFindUnique).toHaveBeenCalledWith({ where: { tenantId_profileId: { tenantId: "tenant-from-session", profileId: "profile-1" } } });
    expect(setTenantConfig).toHaveBeenCalledWith(expect.anything(), "tenant-from-session");
    expect(runtime.createOnBehalf).toHaveBeenCalledOnce();
    const [, identity, tenantContext, passed] = runtime.createOnBehalf.mock.calls[0] as unknown as [unknown, unknown, unknown, unknown];
    expect(identity).toMatchObject({ state: "authenticated", subjectId: "user-1", profileId: "profile-1" });
    expect(tenantContext).toBe(sessionTenant);
    expect(passed).toEqual({ serviceId: "svc", staffId: "own-staff", startAt: input.startAt, customer: input.customer, notifyCustomer: true, whatsappVerbalOptIn: false });
  });

  it.each(["TENANT_ADMIN", "SUPER_ADMIN", "CUSTOMER"])("rejects a %s membership with FORBIDDEN (staff flow is STAFF-only)", async (role) => {
    authenticatedAs(role);
    await expect(createStaffAppointment(input)).resolves.toEqual({ status: "FORBIDDEN" });
    expect(runtime.createOnBehalf).not.toHaveBeenCalled();
  });

  it("rejects an INACTIVE or missing staff row", async () => {
    authenticatedAs("STAFF", { ...ownStaff, status: "INACTIVE" });
    await expect(createStaffAppointment(input)).resolves.toEqual({ status: "FORBIDDEN" });
    authenticatedAs("STAFF", null);
    await expect(createStaffAppointment(input)).resolves.toEqual({ status: "FORBIDDEN" });
    expect(runtime.createOnBehalf).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN without a session", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "unauthenticated" });
    await expect(createStaffAppointment(input)).resolves.toEqual({ status: "FORBIDDEN" });
    expect(readMembership).not.toHaveBeenCalled();
  });

  it("rejects a non-object input before the engine", async () => {
    authenticatedAs("STAFF");
    await expect(createStaffAppointment(null as never)).resolves.toEqual({ status: "INVALID_INPUT" });
    expect(runtime.createOnBehalf).not.toHaveBeenCalled();
  });
});

describe("listStaffSlots / getStaffCreateOptions (WP-08)", () => {
  it("lists slots only for the own staffId", async () => {
    authenticatedAs("STAFF");
    await listStaffSlots({ serviceId: "svc", date: "2026-11-09", staffId: "other-staff" } as never);
    const [, , tenantContext, passed] = runtime.listSlotsOnBehalf.mock.calls[0] as unknown as [unknown, unknown, unknown, unknown];
    expect(tenantContext).toBe(sessionTenant);
    expect(passed).toEqual({ serviceId: "svc", staffId: "own-staff", date: "2026-11-09" });
  });

  it("forbids non-staff and returns null options", async () => {
    authenticatedAs("CUSTOMER");
    await expect(listStaffSlots({ serviceId: "svc", date: "2026-11-09" })).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(getStaffCreateOptions()).resolves.toBeNull();
    expect(runtime.readCreateOptions).not.toHaveBeenCalled();
  });
});
