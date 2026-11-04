import { beforeEach, describe, expect, it, vi } from "vitest";

// WP-07: action-level authorization for tenant settings. The tenant always comes from the
// authenticated session; only an exact TENANT_ADMIN membership may update.
const { readAuthenticatedTenantRequest, readMembership, repositoryRead, repositoryUpdate, prisma } = vi.hoisted(() => ({
  readAuthenticatedTenantRequest: vi.fn(),
  readMembership: vi.fn(),
  repositoryRead: vi.fn(),
  repositoryUpdate: vi.fn(),
  prisma: { marker: "prisma" },
}));

vi.mock("../../infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("../../infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("../../infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({})) }));
vi.mock("../../application/auth-request-boundary", () => ({ readAuthenticatedTenantRequest }));
vi.mock("../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => prisma) }));
vi.mock("../../persistence/prisma-membership-reader", () => ({ createPrismaMembershipReader: vi.fn(() => ({ readMembership })) }));
vi.mock("../../persistence/prisma-tenant-settings", () => ({
  createPrismaTenantSettingsRepository: vi.fn(() => ({ read: repositoryRead, update: repositoryUpdate })),
}));

import { loadTenantSettings, updateTenantSettingsAction } from "./settings-actions";

const sessionTenant = { tenantId: "tenant-from-session" };
const settings = { name: "Salon A", contactPhone: null, status: "ACTIVE", timezone: "Europe/Istanbul" };

function authenticatedAs(role: "TENANT_ADMIN" | "SUPER_ADMIN" | "STAFF" | "CUSTOMER") {
  readAuthenticatedTenantRequest.mockResolvedValue({
    state: "authenticated",
    identity: { state: "authenticated", subjectId: "user-1" },
    tenantContext: sessionTenant,
  });
  readMembership.mockResolvedValue({ status: "found", membership: { profileId: "profile-1", role, tenantId: sessionTenant.tenantId } });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  readAuthenticatedTenantRequest.mockReset();
  readMembership.mockReset();
  repositoryRead.mockReset();
  repositoryRead.mockResolvedValue(settings);
  repositoryUpdate.mockReset();
  repositoryUpdate.mockResolvedValue("updated");
});

describe("updateTenantSettingsAction (WP-07)", () => {
  it("lets a TENANT_ADMIN update only name + normalized phone of the session tenant, ignoring client tenantId/status/timezone", async () => {
    authenticatedAs("TENANT_ADMIN");

    const result = await updateTenantSettingsAction(form({
      name: "Yeni Salon",
      contactPhone: "0555 111 22 33",
      tenantId: "tenant-from-client",
      status: "INACTIVE",
      timezone: "America/New_York",
    }));

    expect(result).toEqual({ ok: true });
    expect(repositoryUpdate).toHaveBeenCalledTimes(1);
    expect(repositoryUpdate).toHaveBeenCalledWith(sessionTenant, { name: "Yeni Salon", contactPhone: "+905551112233" });
  });

  it.each(["SUPER_ADMIN", "STAFF", "CUSTOMER"] as const)("rejects a %s membership with FORBIDDEN and writes nothing", async (role) => {
    authenticatedAs(role);

    await expect(updateTenantSettingsAction(form({ name: "Salon", contactPhone: "" }))).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN without a session and writes nothing", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "unauthenticated" });

    await expect(updateTenantSettingsAction(form({ name: "Salon" }))).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(readMembership).not.toHaveBeenCalled();
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN when the session has no membership in the session tenant", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({
      state: "authenticated",
      identity: { state: "authenticated", subjectId: "user-1" },
      tenantContext: sessionTenant,
    });
    readMembership.mockResolvedValue({ status: "not_found" });

    await expect(updateTenantSettingsAction(form({ name: "Salon" }))).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-E.164 phone with INVALID_CONTACT_PHONE and writes nothing", async () => {
    authenticatedAs("TENANT_ADMIN");

    await expect(updateTenantSettingsAction(form({ name: "Salon", contactPhone: "12" }))).resolves.toEqual({ ok: false, code: "INVALID_CONTACT_PHONE" });
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });
});

describe("loadTenantSettings (WP-07)", () => {
  it.each(["TENANT_ADMIN", "SUPER_ADMIN"] as const)("lets a %s membership read the session tenant's settings", async (role) => {
    authenticatedAs(role);

    // canEdit is a UI hint: only TENANT_ADMIN gets an editable form (update re-checks server-side).
    await expect(loadTenantSettings()).resolves.toEqual({ ok: true, settings, canEdit: role === "TENANT_ADMIN" });
    expect(repositoryRead).toHaveBeenCalledWith(sessionTenant);
  });

  it("forbids a STAFF membership from reading settings", async () => {
    authenticatedAs("STAFF");

    await expect(loadTenantSettings()).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(repositoryRead).not.toHaveBeenCalled();
  });
});
