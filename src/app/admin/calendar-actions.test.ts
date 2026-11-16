import { beforeEach, describe, expect, it, vi } from "vitest";

// WP-08 QA: admin create-appointment actions. Tenant from the session only; TENANT_ADMIN/SUPER_ADMIN
// gate here, the engine re-checks via resolveCreateScope.
const { readAuthenticatedTenantRequest, readMembership, runtime, prisma, deletionRepository, appointmentFindUnique } = vi.hoisted(() => {
  const appointmentFindUnique = vi.fn();
  return {
  appointmentFindUnique,
  deletionRepository: { find: vi.fn(), archive: vi.fn() },
  readAuthenticatedTenantRequest: vi.fn(),
  readMembership: vi.fn(),
  runtime: {
    createOnBehalfBookingEngine: vi.fn(() => ({ marker: "engine" })),
    createOnBehalf: vi.fn(),
    listSlotsOnBehalf: vi.fn(),
    readCreateOptions: vi.fn(),
  },
  prisma: {
    marker: "prisma",
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ $executeRaw: vi.fn(), appointment: { findUnique: appointmentFindUnique } })),
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
vi.mock("../../persistence/prisma-appointment-deletion", () => ({ createPrismaAppointmentDeletionRepository: vi.fn(() => deletionRepository) }));

import { createAdminAppointment, deleteAdminAppointment, getAdminCreateOptions, listAdminSlots, transitionAdminAppointment } from "./calendar-actions";

type Call = [unknown, unknown, unknown, unknown];
const sessionTenant = { tenantId: "tenant-from-session" };
const input = {
  serviceId: "svc", staffId: "any-staff", startAt: "2026-11-09T06:00:00.000Z",
  customer: { kind: "existing" as const, profileId: "c1" }, notifyCustomer: false, whatsappVerbalOptIn: true,
};

function authenticatedAs(role: string) {
  readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: { state: "authenticated", subjectId: "user-1" }, tenantContext: sessionTenant });
  readMembership.mockResolvedValue({ status: "found", membership: { profileId: "profile-1", subjectId: "user-1", role, tenantId: sessionTenant.tenantId } });
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
    expect(passed).toEqual({ serviceId: "svc", staffId: "any-staff", startAt: input.startAt, customer: input.customer, notifyCustomer: false, whatsappVerbalOptIn: true });
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

describe("deleteAdminAppointment", () => {
  const appointment = { id: "a1", tenantId: sessionTenant.tenantId, staffId: "s1", status: "CANCELLED" };

  it("returns FORBIDDEN without a session and for non-admin roles, touching nothing", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "unauthenticated" });
    await expect(deleteAdminAppointment("a1")).resolves.toEqual({ status: "FORBIDDEN" });
    authenticatedAs("STAFF");
    await expect(deleteAdminAppointment("a1")).resolves.toEqual({ status: "FORBIDDEN" });
    expect(deletionRepository.find).not.toHaveBeenCalled();
    expect(deletionRepository.archive).not.toHaveBeenCalled();
  });

  it("refuses a SUPER_ADMIN membership (only TENANT_ADMIN may delete) and writes nothing", async () => {
    authenticatedAs("SUPER_ADMIN");
    deletionRepository.find.mockResolvedValue(appointment);
    await expect(deleteAdminAppointment("a1")).resolves.toEqual({ status: "FORBIDDEN" });
    expect(deletionRepository.archive).not.toHaveBeenCalled();
  });

  it("lets TENANT_ADMIN archive with the session tenant and the submitted id", async () => {
    authenticatedAs("TENANT_ADMIN");
    deletionRepository.find.mockResolvedValue(appointment);
    deletionRepository.archive.mockResolvedValue("archived");
    await expect(deleteAdminAppointment("a1")).resolves.toEqual({ status: "DELETED" });
    expect(deletionRepository.find).toHaveBeenCalledWith(sessionTenant, "a1");
    expect(deletionRepository.archive).toHaveBeenCalledWith(sessionTenant, "a1", expect.any(Date));
  });

  it("maps a thrown error to PERSISTENCE_FAILURE", async () => {
    authenticatedAs("TENANT_ADMIN");
    deletionRepository.find.mockRejectedValue(new Error("db"));
    await expect(deleteAdminAppointment("a1")).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
  });
});

describe("transitionAdminAppointment archived lookup", () => {
  it("filters archived appointments out so they resolve to NOT_FOUND", async () => {
    authenticatedAs("TENANT_ADMIN");
    appointmentFindUnique.mockResolvedValue(null);
    await expect(transitionAdminAppointment("a1", "CONFIRMED")).resolves.toEqual({ status: "NOT_FOUND" });
    expect(appointmentFindUnique).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: sessionTenant.tenantId, id: "a1" }, deletedAt: null },
    });
  });
});
