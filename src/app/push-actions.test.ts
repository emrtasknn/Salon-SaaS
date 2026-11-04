import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WP-09 QA: subscribe/unsubscribe actions bind tenant + profile to the authenticated
// session/membership only, fail closed, and never expose endpoint/keys in logs.
const { readAuthenticatedTenantRequest, readMembership, repository, prisma } = vi.hoisted(() => ({
  readAuthenticatedTenantRequest: vi.fn(),
  readMembership: vi.fn(),
  repository: { readEligibility: vi.fn(), upsert: vi.fn(), revoke: vi.fn() },
  prisma: { marker: "prisma" },
}));

vi.mock("../infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("../infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("../infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({})) }));
vi.mock("../application/auth-request-boundary", () => ({ readAuthenticatedTenantRequest }));
vi.mock("../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => prisma) }));
vi.mock("../persistence/prisma-membership-reader", () => ({ createPrismaMembershipReader: vi.fn(() => ({ readMembership })) }));
vi.mock("../persistence/prisma-push-subscription", () => ({ createPrismaPushSubscriptionRepository: vi.fn(() => repository) }));

import { getWebPushConfigAction, subscribeWebPushAction, unsubscribeWebPushAction } from "./push-actions";

const P256DH = `B${"a".repeat(86)}`;
const AUTH = "b".repeat(22);
const ENDPOINT = "https://push.example.com/secret-device-id";
const input = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH }, userAgent: "UA" };
const sessionTenant = { tenantId: "tenant-from-session" };
const VAPID = { WEB_PUSH_VAPID_PUBLIC_KEY: P256DH, WEB_PUSH_VAPID_PRIVATE_KEY: "c".repeat(43), WEB_PUSH_VAPID_SUBJECT: "mailto:ops@example.com" };
const saved: Record<string, string | undefined> = {};

function setVapid(enabled: boolean) {
  for (const [key, value] of Object.entries(VAPID)) {
    if (enabled) process.env[key] = value;
    else delete process.env[key];
  }
}

function authenticatedAs(role: string) {
  readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: { state: "authenticated", subjectId: "user-1" }, tenantContext: sessionTenant });
  readMembership.mockResolvedValue({ status: "found", membership: { profileId: "profile-1", role, tenantId: sessionTenant.tenantId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(VAPID)) saved[key] = process.env[key];
  setVapid(true);
  repository.readEligibility.mockResolvedValue({ tenantStatus: "ACTIVE", staffStatus: "ACTIVE" });
  repository.upsert.mockResolvedValue(undefined);
  repository.revoke.mockResolvedValue(1);
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe("subscribeWebPushAction (WP-09)", () => {
  it("upserts under the session tenant and membership profile, ignoring client tenant/profile ids", async () => {
    authenticatedAs("STAFF");
    await expect(subscribeWebPushAction({ ...input, tenantId: "tenant-from-client", profileId: "evil" } as never)).resolves.toEqual({ status: "subscribed" });
    expect(repository.upsert).toHaveBeenCalledOnce();
    const [tenantContext, passed] = repository.upsert.mock.calls[0];
    expect(tenantContext).toBe(sessionTenant);
    expect(passed).toMatchObject({ profileId: "profile-1", endpoint: ENDPOINT });
  });

  it("UNAUTHORIZED without a session", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "unauthenticated" });
    await expect(subscribeWebPushAction(input)).resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("FORBIDDEN without a membership in the session tenant", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: {}, tenantContext: sessionTenant });
    readMembership.mockResolvedValue({ status: "not_found" });
    await expect(subscribeWebPushAction(input)).resolves.toEqual({ status: "FORBIDDEN" });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("FORBIDDEN for the CUSTOMER role", async () => {
    authenticatedAs("CUSTOMER");
    await expect(subscribeWebPushAction(input)).resolves.toEqual({ status: "FORBIDDEN" });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("FORBIDDEN for an INACTIVE staff member", async () => {
    authenticatedAs("STAFF");
    repository.readEligibility.mockResolvedValue({ tenantStatus: "ACTIVE", staffStatus: "INACTIVE" });
    await expect(subscribeWebPushAction(input)).resolves.toEqual({ status: "FORBIDDEN" });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("FORBIDDEN for an INACTIVE tenant", async () => {
    authenticatedAs("TENANT_ADMIN");
    repository.readEligibility.mockResolvedValue({ tenantStatus: "INACTIVE", staffStatus: null });
    await expect(subscribeWebPushAction(input)).resolves.toEqual({ status: "FORBIDDEN" });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("NOT_CONFIGURED when VAPID env is missing", async () => {
    setVapid(false);
    authenticatedAs("TENANT_ADMIN");
    await expect(subscribeWebPushAction(input)).resolves.toEqual({ status: "NOT_CONFIGURED" });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("INVALID for a non-https endpoint", async () => {
    authenticatedAs("TENANT_ADMIN");
    await expect(subscribeWebPushAction({ ...input, endpoint: "http://push.example.com/x" })).resolves.toEqual({ status: "INVALID" });
  });

  it("fails closed with FORBIDDEN on a repository error and logs no endpoint/keys", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authenticatedAs("STAFF");
    repository.upsert.mockRejectedValue(Object.assign(new Error(`insert failed for ${ENDPOINT}`), { endpoint: ENDPOINT }));
    await expect(subscribeWebPushAction(input)).resolves.toEqual({ status: "FORBIDDEN" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("secret-device-id");
    expect(logged).not.toContain(P256DH);
    expect(logged).not.toContain(AUTH);
  });
});

describe("unsubscribeWebPushAction (WP-09)", () => {
  it("revokes only the caller's own row in the session tenant", async () => {
    authenticatedAs("STAFF");
    await expect(unsubscribeWebPushAction({ endpoint: ENDPOINT, profileId: "other" } as never)).resolves.toEqual({ status: "revoked" });
    expect(repository.revoke).toHaveBeenCalledWith(sessionTenant, expect.objectContaining({ profileId: "profile-1", endpoint: ENDPOINT }));
  });

  it("UNAUTHORIZED without a session; not_found without membership", async () => {
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "unauthenticated" });
    await expect(unsubscribeWebPushAction({ endpoint: ENDPOINT })).resolves.toEqual({ status: "UNAUTHORIZED" });
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "authenticated", identity: {}, tenantContext: sessionTenant });
    readMembership.mockResolvedValue({ status: "not_found" });
    await expect(unsubscribeWebPushAction({ endpoint: ENDPOINT })).resolves.toEqual({ status: "not_found" });
    expect(repository.revoke).not.toHaveBeenCalled();
  });

  it("still lets an INACTIVE staff member revoke their own device (logout cleanup)", async () => {
    authenticatedAs("STAFF");
    repository.readEligibility.mockResolvedValue({ tenantStatus: "INACTIVE", staffStatus: "INACTIVE" });
    await expect(unsubscribeWebPushAction({ endpoint: ENDPOINT })).resolves.toEqual({ status: "revoked" });
  });
});

describe("getWebPushConfigAction (WP-09)", () => {
  it("returns the public key only to STAFF / TENANT_ADMIN sessions", async () => {
    authenticatedAs("STAFF");
    await expect(getWebPushConfigAction()).resolves.toEqual({ enabled: true, publicKey: P256DH });
    authenticatedAs("CUSTOMER");
    await expect(getWebPushConfigAction()).resolves.toEqual({ enabled: false });
    readAuthenticatedTenantRequest.mockResolvedValue({ state: "unauthenticated" });
    await expect(getWebPushConfigAction()).resolves.toEqual({ enabled: false });
  });

  it("is disabled when VAPID env is missing and never leaks the private key", async () => {
    authenticatedAs("TENANT_ADMIN");
    const enabled = await getWebPushConfigAction();
    expect(JSON.stringify(enabled)).not.toContain(VAPID.WEB_PUSH_VAPID_PRIVATE_KEY);
    setVapid(false);
    await expect(getWebPushConfigAction()).resolves.toEqual({ enabled: false });
  });
});
