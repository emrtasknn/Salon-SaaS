import { describe, expect, it, vi } from "vitest";
import { createPushSubscriptions, type PushSession } from "./push-subscriptions";

const P256DH = `B${"a".repeat(86)}`;
const AUTH = "b".repeat(22);
const ENDPOINT = "https://push.example.com/abc";
const input = { endpoint: ENDPOINT, keys: { p256dh: `${P256DH}=`, auth: AUTH }, userAgent: "UA" };
const tenantContext = { tenantId: "tenant-1" as never };

function session(role: PushSession["role"]): PushSession {
  return { tenantContext, profileId: "profile-1", role };
}

function setup(eligibility = { tenantStatus: "ACTIVE" as const, staffStatus: "ACTIVE" as const } as {
  tenantStatus: "ACTIVE" | "INACTIVE" | null; staffStatus: "ACTIVE" | "INACTIVE" | null;
}, configured = true) {
  const repository = {
    readEligibility: vi.fn().mockResolvedValue(eligibility),
    upsert: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(1),
  };
  const service = createPushSubscriptions({ repository, configured, now: () => new Date(0) });
  return { repository, service };
}

describe("push subscriptions (WP-09)", () => {
  it("upserts the caller's subscription from the session tenant/profile with stripped padding", async () => {
    const { repository, service } = setup();
    await expect(service.subscribe(session("STAFF"), { ...input, tenantId: "evil", profileId: "evil" })).resolves.toEqual({ status: "subscribed" });
    expect(repository.upsert).toHaveBeenCalledWith(tenantContext, {
      profileId: "profile-1", endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH, userAgent: "UA", at: new Date(0),
    });
  });

  it("lets a TENANT_ADMIN without a Staff row subscribe", async () => {
    const { service } = setup({ tenantStatus: "ACTIVE", staffStatus: null });
    await expect(service.subscribe(session("TENANT_ADMIN"), input)).resolves.toEqual({ status: "subscribed" });
  });

  it.each([
    ["unauthenticated", "UNAUTHORIZED" as const, "UNAUTHORIZED"],
    ["no membership", "FORBIDDEN" as const, "FORBIDDEN"],
    ["customer", session("CUSTOMER"), "FORBIDDEN"],
    ["super admin", session("SUPER_ADMIN"), "FORBIDDEN"],
  ])("%s -> %s", async (_label, s, status) => {
    const { repository, service } = setup();
    await expect(service.subscribe(s, input)).resolves.toEqual({ status });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("STAFF with INACTIVE or missing Staff row -> FORBIDDEN", async () => {
    for (const staffStatus of ["INACTIVE", null] as const) {
      const { repository, service } = setup({ tenantStatus: "ACTIVE", staffStatus });
      await expect(service.subscribe(session("STAFF"), input)).resolves.toEqual({ status: "FORBIDDEN" });
      expect(repository.upsert).not.toHaveBeenCalled();
    }
  });

  it("INACTIVE tenant -> FORBIDDEN (fail closed)", async () => {
    const { repository, service } = setup({ tenantStatus: "INACTIVE", staffStatus: "ACTIVE" });
    await expect(service.subscribe(session("TENANT_ADMIN"), input)).resolves.toEqual({ status: "FORBIDDEN" });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("VAPID not configured -> NOT_CONFIGURED", async () => {
    const { service } = setup(undefined, false);
    await expect(service.subscribe(session("STAFF"), input)).resolves.toEqual({ status: "NOT_CONFIGURED" });
  });

  it("invalid input -> INVALID", async () => {
    const { repository, service } = setup();
    await expect(service.subscribe(session("STAFF"), { ...input, endpoint: "http://push.example.com/x" })).resolves.toEqual({ status: "INVALID" });
    await expect(service.subscribe(session("STAFF"), { ...input, keys: { p256dh: P256DH, auth: "short" } })).resolves.toEqual({ status: "INVALID" });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("unsubscribe revokes only the caller's row and never deletes", async () => {
    const { repository, service } = setup();
    await expect(service.unsubscribe(session("STAFF"), { endpoint: ENDPOINT })).resolves.toEqual({ status: "revoked" });
    expect(repository.revoke).toHaveBeenCalledWith(tenantContext, { profileId: "profile-1", endpoint: ENDPOINT, at: new Date(0) });
    repository.revoke.mockResolvedValue(0);
    await expect(service.unsubscribe(session("STAFF"), { endpoint: ENDPOINT })).resolves.toEqual({ status: "not_found" });
    await expect(service.unsubscribe(session("STAFF"), { endpoint: "nope" })).resolves.toEqual({ status: "not_found" });
    await expect(service.unsubscribe("UNAUTHORIZED", { endpoint: ENDPOINT })).resolves.toEqual({ status: "UNAUTHORIZED" });
  });
});
