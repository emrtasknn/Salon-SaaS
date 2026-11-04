import { beforeEach, describe, expect, it, vi } from "vitest";

// WP-08 QA: closure actions are TENANT_ADMIN-only and always use the session tenant.
const { readAuthenticatedTenantRequest, readMembership, enforceServerAuthorization, repository, prisma } = vi.hoisted(() => ({
  readAuthenticatedTenantRequest: vi.fn(),
  readMembership: vi.fn(),
  enforceServerAuthorization: vi.fn(),
  repository: { list: vi.fn(), impact: vi.fn(), create: vi.fn(), delete: vi.fn() },
  prisma: { marker: "prisma" },
}));

vi.mock("../../infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("../../infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("../../infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({})) }));
vi.mock("../../application/auth-request-boundary", () => ({ readAuthenticatedTenantRequest }));
vi.mock("../../application/server-authorization-enforcement", () => ({ enforceServerAuthorization }));
vi.mock("../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => prisma) }));
vi.mock("../../persistence/prisma-membership-reader", () => ({ createPrismaMembershipReader: vi.fn(() => ({ readMembership })) }));
vi.mock("../../persistence/prisma-closure-dates", () => ({ createPrismaClosureDateRepository: vi.fn(() => repository) }));

import { createClosure, deleteClosure, listClosures } from "./closure-actions";

const sessionTenant = { tenantId: "tenant-from-session" };

function authenticatedAs(role: string) {
  readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: { state: "authenticated", subjectId: "user-1" }, tenantContext: sessionTenant });
  readMembership.mockResolvedValue({ status: "found", membership: { profileId: "profile-1", role, tenantId: sessionTenant.tenantId } });
  enforceServerAuthorization.mockResolvedValue({ authorization: { status: role === "TENANT_ADMIN" || role === "SUPER_ADMIN" ? "allowed" : "denied" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  repository.create.mockResolvedValue({ status: "created", closure: { id: "cl1", date: "2099-01-01", reason: null } });
  repository.delete.mockResolvedValue("deleted");
  repository.list.mockResolvedValue({ timezone: "Europe/Istanbul", closures: [] });
});

describe("closure actions (WP-08)", () => {
  it("creates in the session tenant with the caller profile, ignoring a client tenantId", async () => {
    authenticatedAs("TENANT_ADMIN");
    await createClosure({ date: "2099-01-01", confirmExistingAppointments: false, tenantId: "tenant-from-client" } as never);
    expect(repository.create).toHaveBeenCalledOnce();
    const [tenantContext, passed] = repository.create.mock.calls[0] as unknown as [unknown, unknown];
    expect(tenantContext).toBe(sessionTenant);
    expect(passed).toMatchObject({ date: "2099-01-01", reason: null, createdByProfileId: "profile-1", confirmExistingAppointments: false });
  });

  it.each(["STAFF", "CUSTOMER"])("%s cannot list, create or delete closures", async (role) => {
    authenticatedAs(role);
    await expect(createClosure({ date: "2099-01-01", confirmExistingAppointments: true })).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(deleteClosure("cl1")).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(listClosures({ from: "2099-01-01", to: "2099-01-31" })).resolves.toEqual({ status: "FORBIDDEN" });
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
    expect(repository.list).not.toHaveBeenCalled();
  });

  it("deletes only through the session tenant", async () => {
    authenticatedAs("TENANT_ADMIN");
    await expect(deleteClosure("cl1")).resolves.toEqual({ status: "DELETED" });
    expect(repository.delete).toHaveBeenCalledWith(sessionTenant, "cl1");
  });

  it("returns FORBIDDEN without a session", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "unauthenticated" });
    await expect(createClosure({ date: "2099-01-01", confirmExistingAppointments: false })).resolves.toEqual({ status: "FORBIDDEN" });
    expect(repository.create).not.toHaveBeenCalled();
  });
});
