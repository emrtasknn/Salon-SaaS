import { beforeEach, describe, expect, it, vi } from "vitest";

// Owner decision 2026-11-05: admin-serves-as-staff server action and admin data flag.
// Tenant and profile come only from the session; the action takes no ids.
const { readAuthenticatedTenantRequest, readMembership, selfRepository } = vi.hoisted(() => ({
  readAuthenticatedTenantRequest: vi.fn(),
  readMembership: vi.fn(),
  selfRepository: { findOwnStatus: vi.fn(), setOwnStatus: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("../../infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("../../infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("../../infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({})) }));
vi.mock("../../infrastructure/auth/supabase-admin-auth", () => ({ createSupabaseAdminAuthProvisioner: vi.fn(() => ({})) }));
vi.mock("../../infrastructure/auth/supabase-tenant-admin-binding", () => ({ createSupabaseTenantAdminAuthBinding: vi.fn(() => ({})) }));
vi.mock("../../application/auth-request-boundary", () => ({ readAuthenticatedTenantRequest }));
vi.mock("../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => ({})) }));
vi.mock("../../persistence/prisma-membership-reader", () => ({ createPrismaMembershipReader: vi.fn(() => ({ readMembership })) }));
vi.mock("../../persistence/prisma-service-management", () => ({ createPrismaServiceRepository: vi.fn(() => ({ list: vi.fn().mockResolvedValue([]) })) }));
vi.mock("../../persistence/prisma-working-hours-management", () => ({ createPrismaWorkingHoursRepository: vi.fn(() => ({ list: vi.fn().mockResolvedValue([]) })) }));
vi.mock("../../persistence/prisma-staff-management", () => ({
  createPrismaStaffRepository: vi.fn(() => ({ list: vi.fn().mockResolvedValue([]) })),
  createPrismaAdminSelfStaffRepository: vi.fn(() => selfRepository),
}));

import { listAdminData, setAdminServesAsStaffAction } from "./actions";

const sessionTenant = { tenantId: "tenant-from-session" };

function authenticatedAs(role: string) {
  readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: { state: "authenticated", subjectId: "user-1" }, tenantContext: sessionTenant });
  readMembership.mockResolvedValue({ status: "found", membership: { profileId: "profile-1", role, tenantId: sessionTenant.tenantId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  selfRepository.findOwnStatus.mockResolvedValue("ACTIVE");
  selfRepository.setOwnStatus.mockResolvedValue("updated");
});

describe("setAdminServesAsStaffAction", () => {
  it("changes only the signed-in TENANT_ADMIN's own row in the session tenant", async () => {
    authenticatedAs("TENANT_ADMIN");
    const action = setAdminServesAsStaffAction as (...args: unknown[]) => Promise<unknown>;
    await expect(action(true, "other-profile", "other-tenant")).resolves.toEqual({ status: "ok", servesAsStaff: true });
    expect(selfRepository.setOwnStatus).toHaveBeenCalledExactlyOnceWith(sessionTenant, "profile-1", "ACTIVE");
  });

  it.each(["SUPER_ADMIN", "STAFF", "CUSTOMER"])("refuses a %s membership", async (role) => {
    authenticatedAs(role);
    await expect(setAdminServesAsStaffAction(true)).resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(selfRepository.setOwnStatus).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "unauthenticated" });
    await expect(setAdminServesAsStaffAction(true)).resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(readMembership).not.toHaveBeenCalled();
  });
});

describe("listAdminData adminServesAsStaff", () => {
  it("is true only for an own ACTIVE staff row", async () => {
    authenticatedAs("TENANT_ADMIN");
    await expect(listAdminData()).resolves.toMatchObject({ status: "ok", adminServesAsStaff: true });
    selfRepository.findOwnStatus.mockResolvedValue("INACTIVE");
    await expect(listAdminData()).resolves.toMatchObject({ status: "ok", adminServesAsStaff: false });
  });

  it("is false for a SUPER_ADMIN or on a persistence failure", async () => {
    authenticatedAs("SUPER_ADMIN");
    await expect(listAdminData()).resolves.toMatchObject({ status: "ok", adminServesAsStaff: false });
    authenticatedAs("TENANT_ADMIN");
    selfRepository.findOwnStatus.mockRejectedValue(new Error("db down"));
    await expect(listAdminData()).resolves.toMatchObject({ status: "ok", adminServesAsStaff: false });
  });
});
