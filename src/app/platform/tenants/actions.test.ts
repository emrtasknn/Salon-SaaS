import { beforeEach, describe, expect, it, vi } from "vitest";

// WP-07 owner decision (a): the tenant status toggle is a platform (SUPER_ADMIN) action only.
// A TENANT_ADMIN session has no platformRole, so readAuthenticatedPlatformRequest is unauthenticated.
const { readAuthenticatedPlatformRequest, repositoryList, repositorySetStatus, prisma } = vi.hoisted(() => ({
  readAuthenticatedPlatformRequest: vi.fn(),
  repositoryList: vi.fn(),
  repositorySetStatus: vi.fn(),
  prisma: { marker: "prisma" },
}));

vi.mock("@/infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("@/infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("@/infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({})) }));
vi.mock("@/infrastructure/auth/supabase-tenant-admin-binding", () => ({ createSupabaseTenantAdminAuthBinding: vi.fn() }));
vi.mock("@/infrastructure/auth/supabase-admin-auth", () => ({ createSupabaseAdminAuthProvisioner: vi.fn() }));
vi.mock("@/application/tenant-provisioning", () => ({ createTenantProvisioner: vi.fn() }));
vi.mock("@/persistence/prisma-tenant-provisioning", () => ({ createPrismaTenantProvisioningRepository: vi.fn() }));
vi.mock("@/application/auth-request-boundary", () => ({ readAuthenticatedPlatformRequest }));
vi.mock("@/infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => prisma) }));
// vitest has no "@/" alias: route the real application service through its relative path (not a stub).
vi.mock("@/application/platform-tenant-status", () => import("../../../application/platform-tenant-status"));
vi.mock("@/persistence/prisma-platform-tenants", () => ({
  createPrismaPlatformTenantRepository: vi.fn(() => ({ list: repositoryList, setStatus: repositorySetStatus })),
}));

import { listPlatformTenants, setTenantStatusAction } from "./actions";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  readAuthenticatedPlatformRequest.mockReset();
  repositoryList.mockReset();
  repositoryList.mockResolvedValue([{ id: "tenant-a", slug: "salon-a", name: "Salon A", status: "ACTIVE" }]);
  repositorySetStatus.mockReset();
  repositorySetStatus.mockResolvedValue("updated");
});

describe("setTenantStatusAction (WP-07)", () => {
  it("returns FORBIDDEN for a non-platform (e.g. TENANT_ADMIN) session and writes nothing", async () => {
    readAuthenticatedPlatformRequest.mockResolvedValue({ state: "unauthenticated" });

    await expect(setTenantStatusAction(form({ tenantId: "tenant-a", status: "INACTIVE" })))
      .resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repositorySetStatus).not.toHaveBeenCalled();
  });

  it("lets SUPER_ADMIN set the status of exactly the submitted tenant", async () => {
    readAuthenticatedPlatformRequest.mockResolvedValue({
      state: "authenticated", identity: { state: "authenticated", subjectId: "platform-user" }, platformRole: "SUPER_ADMIN",
    });

    await expect(setTenantStatusAction(form({ tenantId: "tenant-a", status: "INACTIVE" }))).resolves.toEqual({ ok: true });
    expect(repositorySetStatus).toHaveBeenCalledTimes(1);
    expect(repositorySetStatus).toHaveBeenCalledWith("tenant-a", "INACTIVE");
  });

  it("rejects an unknown status value with INVALID_INPUT and writes nothing", async () => {
    readAuthenticatedPlatformRequest.mockResolvedValue({
      state: "authenticated", identity: { state: "authenticated", subjectId: "platform-user" }, platformRole: "SUPER_ADMIN",
    });

    await expect(setTenantStatusAction(form({ tenantId: "tenant-a", status: "DELETED" })))
      .resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(repositorySetStatus).not.toHaveBeenCalled();
  });

  it("maps a missing tenant to NOT_FOUND", async () => {
    readAuthenticatedPlatformRequest.mockResolvedValue({
      state: "authenticated", identity: { state: "authenticated", subjectId: "platform-user" }, platformRole: "SUPER_ADMIN",
    });
    repositorySetStatus.mockResolvedValue("not_found");

    await expect(setTenantStatusAction(form({ tenantId: "missing", status: "ACTIVE" })))
      .resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("listPlatformTenants (WP-07)", () => {
  it("returns FORBIDDEN for a non-platform session without reading tenants", async () => {
    readAuthenticatedPlatformRequest.mockResolvedValue({ state: "unauthenticated" });

    await expect(listPlatformTenants()).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repositoryList).not.toHaveBeenCalled();
  });
});
