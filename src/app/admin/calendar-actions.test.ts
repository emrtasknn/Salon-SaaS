import { beforeEach, describe, expect, it, vi } from "vitest";

// WP-08 QA: admin create-appointment actions. Tenant from the session only; TENANT_ADMIN/SUPER_ADMIN
// gate here, the engine re-checks via resolveCreateScope.
const { readAuthenticatedTenantRequest, readMembership, runtime, prisma } = vi.hoisted(() => ({
  readAuthenticatedTenantRequest: vi.fn(),
  readMembership: vi.fn(),
  runtime: {
    createOnBehalfBookingEngine: vi.fn(() => ({ marker: "engine" })),
    createOnBehalf: vi.fn(),
    listSlotsOnBehalf: vi.fn(),
    readCreateOptions: vi.fn(),
  },
  prisma: { marker: "prisma" },
}));

vi.mock("../../infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("../../infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("../../infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({})) }));
vi.mock("../../application/auth-request-boundary", () => ({ readAuthenticatedTenantRequest }));
vi.mock("../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => prisma) }));
vi.mock("../../persistence/prisma-membership-reader", () => ({ createPrismaMembershipReader: vi.fn(() => ({ readMembership })) }));
vi.mock("../notification-runtime", () => ({ publishAppointmentNotification: vi.fn() }));
vi.mock("../appointment-create-runtime", () => runtime);

import { createAdminAppointment, getAdminCreateOptions, listAdminSlots } from "./calendar-actions";

type Call = [unknown, unknown, unknown, unknown];
const sessionTenant = { tenantId: "tenant-from-session" };
const input = {
  serviceId: "svc", staffId: "any-staff", startAt: "2026-11-09T06:00:00.000Z",
  customer: { kind: "existing" as const, profileId: "c1" }, notifyCustomer: false,
};

function authenticatedAs(role: string) {
  readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: { state: "authenticated", subjectId: "user-1" }, tenantContext: sessionTenant });
  readMembership.mockResolvedValue({ status: "found", membership: { profileId: "profile-1", role, tenantId: sessionTenant.tenantId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.createOnBehalf.mockResolvedValue({ status: "CREATED", appointmentId: "a1", notified: false });
  runtime.listSlotsOnBehalf.mockResolvedValue({ status: "OK", slots: [] });
  runtime.readCreateOptions.mockResolvedValue({ timezone: "Europe/Istanbul", services: [], staff: [] });
});

describe("createAdminAppointment (WP-08)", () => {
  it.each(["TENANT_ADMIN", "SUPER_ADMIN"])("%s: forwards the chosen staff and customer with the session tenant, ignoring client tenantId", async (role) => {
    authenticatedAs(role);
    await expect(createAdminAppointment({ ...input, tenantId: "tenant-from-client" } as never))
      .resolves.toEqual({ status: "CREATED", appointmentId: "a1", notified: false });
    const [, identity, tenantContext, passed] = runtime.createOnBehalf.mock.calls[0] as unknown as Call;
    expect(identity).toMatchObject({ subjectId: "user-1", profileId: "profile-1" });
    expect(tenantContext).toBe(sessionTenant);
    expect(passed).toEqual({ serviceId: "svc", staffId: "any-staff", startAt: input.startAt, customer: input.customer, notifyCustomer: false });
  });

  it.each(["STAFF", "CUSTOMER"])("rejects a %s membership with FORBIDDEN", async (role) => {
    authenticatedAs(role);
    await expect(createAdminAppointment(input)).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(listAdminSlots({ serviceId: "svc", staffId: "s", date: "2026-11-09" })).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(getAdminCreateOptions()).resolves.toBeNull();
    expect(runtime.createOnBehalf).not.toHaveBeenCalled();
    expect(runtime.listSlotsOnBehalf).not.toHaveBeenCalled();
    expect(runtime.readCreateOptions).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN without a session or membership", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "unauthenticated" });
    await expect(createAdminAppointment(input)).resolves.toEqual({ status: "FORBIDDEN" });
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: { state: "authenticated", subjectId: "user-1" }, tenantContext: sessionTenant });
    readMembership.mockResolvedValue({ status: "not_found" });
    await expect(createAdminAppointment(input)).resolves.toEqual({ status: "FORBIDDEN" });
    expect(runtime.createOnBehalf).not.toHaveBeenCalled();
  });

  it("lists slots for the requested staff with the session tenant", async () => {
    authenticatedAs("TENANT_ADMIN");
    await listAdminSlots({ serviceId: "svc", staffId: "s2", date: "2026-11-09" });
    const [, , tenantContext, passed] = runtime.listSlotsOnBehalf.mock.calls[0] as unknown as Call;
    expect(tenantContext).toBe(sessionTenant);
    expect(passed).toEqual({ serviceId: "svc", staffId: "s2", date: "2026-11-09" });
  });
});
