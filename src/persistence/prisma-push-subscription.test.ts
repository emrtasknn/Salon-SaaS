import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../domain/tenant-context";
import { readPushRecipients } from "./prisma-notification";
import { createPrismaPushNotificationRepository, createPrismaPushSubscriptionRepository } from "./prisma-push-subscription";

// WP-09 QA (unit, fake Prisma tx): every query runs in withPrismaTenantContext and filters on
// the trusted tenantId; revocation never deletes; routing excludes inactive / non-member staff.

function tenantContext(value: string) {
  const tenantId = createTenantId(value);
  if (!tenantId.ok) throw new Error(tenantId.error.message);
  return { tenantId: tenantId.value };
}

const tenant = tenantContext("tenant-a");
const at = new Date("2026-11-05T10:00:00Z");

function fakePrisma(tx: Record<string, unknown>) {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const prisma = { $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => operation({ $executeRaw: executeRaw, ...tx })) };
  return { prisma: prisma as never, executeRaw };
}

function pushSubscriptionTx() {
  return {
    upsert: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findMany: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  };
}

describe("Prisma push subscription repository (WP-09)", () => {
  it("upsert reassigns an existing (tenant, endpoint) row to the caller and resets revocation/failures", async () => {
    const pushSubscription = pushSubscriptionTx();
    const { prisma, executeRaw } = fakePrisma({ pushSubscription });
    await createPrismaPushSubscriptionRepository(prisma).upsert(tenant, {
      profileId: "profile-2", endpoint: "https://push.example.com/e", p256dh: "p", auth: "a", userAgent: null, at,
    });
    expect(executeRaw).toHaveBeenCalledOnce();
    const args = pushSubscription.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId_endpoint: { tenantId: "tenant-a", endpoint: "https://push.example.com/e" } });
    expect(args.create).toMatchObject({ tenantId: "tenant-a", profileId: "profile-2" });
    expect(args.update).toMatchObject({ profileId: "profile-2", revokedAt: null, failureCount: 0, lastSeenAt: at });
    expect(args.update).not.toHaveProperty("tenantId");
  });

  it("revoke only touches the caller's own active row and never deletes", async () => {
    const pushSubscription = pushSubscriptionTx();
    pushSubscription.updateMany.mockResolvedValue({ count: 0 });
    const { prisma } = fakePrisma({ pushSubscription });
    await expect(createPrismaPushSubscriptionRepository(prisma).revoke(tenant, { profileId: "profile-1", endpoint: "https://push.example.com/e", at }))
      .resolves.toBe(0);
    expect(pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", endpoint: "https://push.example.com/e", profileId: "profile-1", revokedAt: null },
      data: { revokedAt: at },
    });
    expect(pushSubscription.delete).not.toHaveBeenCalled();
    expect(pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it("readEligibility reads tenant and staff status inside the tenant context", async () => {
    const tenantFind = vi.fn().mockResolvedValue({ status: "INACTIVE" });
    const staffFind = vi.fn().mockResolvedValue(null);
    const { prisma, executeRaw } = fakePrisma({ tenant: { findUnique: tenantFind }, staff: { findUnique: staffFind } });
    await expect(createPrismaPushSubscriptionRepository(prisma).readEligibility(tenant, "profile-1"))
      .resolves.toEqual({ tenantStatus: "INACTIVE", staffStatus: null });
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(staffFind.mock.calls[0][0].where).toEqual({ tenantId_profileId: { tenantId: "tenant-a", profileId: "profile-1" } });
  });
});

describe("Prisma push notification repository (WP-09)", () => {
  it("activeSubscriptions excludes revoked rows and is tenant + profile scoped", async () => {
    const pushSubscription = pushSubscriptionTx();
    const { prisma } = fakePrisma({ pushSubscription });
    await createPrismaPushNotificationRepository(prisma).activeSubscriptions(tenant, "profile-1");
    expect(pushSubscription.findMany.mock.calls[0][0].where).toEqual({ tenantId: "tenant-a", profileId: "profile-1", revokedAt: null });
  });

  it("ok resets failureCount and records lastSuccessAt", async () => {
    const pushSubscription = pushSubscriptionTx();
    const { prisma } = fakePrisma({ pushSubscription });
    await createPrismaPushNotificationRepository(prisma).recordPushResult(tenant, { subscriptionId: "s1", outcome: "ok", at });
    expect(pushSubscription.updateMany).toHaveBeenCalledOnce();
    expect(pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: "s1", revokedAt: null },
      data: { failureCount: 0, lastSuccessAt: at },
    });
  });

  it("gone (404/410) revokes immediately without deleting", async () => {
    const pushSubscription = pushSubscriptionTx();
    const { prisma } = fakePrisma({ pushSubscription });
    await createPrismaPushNotificationRepository(prisma).recordPushResult(tenant, { subscriptionId: "s1", outcome: "gone", at });
    expect(pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: "s1", revokedAt: null },
      data: { revokedAt: at, lastFailureAt: at },
    });
    expect(pushSubscription.delete).not.toHaveBeenCalled();
  });

  it.each(["transient", "network"] as const)("%s increments failureCount, then revokes only at >= 5", async (outcome) => {
    const pushSubscription = pushSubscriptionTx();
    const { prisma } = fakePrisma({ pushSubscription });
    await createPrismaPushNotificationRepository(prisma).recordPushResult(tenant, { subscriptionId: "s1", outcome, at });
    expect(pushSubscription.updateMany).toHaveBeenNthCalledWith(1, {
      where: { tenantId: "tenant-a", id: "s1", revokedAt: null },
      data: { failureCount: { increment: 1 }, lastFailureAt: at },
    });
    expect(pushSubscription.updateMany).toHaveBeenNthCalledWith(2, {
      where: { tenantId: "tenant-a", id: "s1", revokedAt: null, failureCount: { gte: 5 } },
      data: { revokedAt: at },
    });
  });

  it("config_error (400/403/413) never touches the subscription", async () => {
    const pushSubscription = pushSubscriptionTx();
    const { prisma, executeRaw } = fakePrisma({ pushSubscription });
    await createPrismaPushNotificationRepository(prisma).recordPushResult(tenant, { subscriptionId: "s1", outcome: "config_error", at });
    expect(pushSubscription.updateMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe("readPushRecipients (WP-09 routing)", () => {
  function routing(staff: { profileId: string; status: "ACTIVE" | "INACTIVE" }, memberships: Array<{ profileId: string; role: string }>) {
    const findMany = vi.fn().mockResolvedValue(memberships);
    const appointmentFind = vi.fn().mockResolvedValue({
      id: "appt-1", startAt: at, service: { name: "Saç kesimi" }, staff,
    });
    const { prisma } = fakePrisma({
      appointment: { findUnique: appointmentFind },
      tenant: { findUnique: vi.fn().mockResolvedValue({ timezone: "Europe/Istanbul" }) },
      tenantMembership: { findMany },
    });
    return { prisma, findMany, appointmentFind };
  }

  it("routes CREATED to the ACTIVE assigned staff plus all admins and selects no customer data", async () => {
    const { prisma, findMany, appointmentFind } = routing({ profileId: "staff-1", status: "ACTIVE" }, [
      { profileId: "admin-1", role: "TENANT_ADMIN" }, { profileId: "staff-1", role: "STAFF" },
    ]);
    const result = await readPushRecipients(prisma, tenant, "appt-1");
    expect(result?.recipients).toEqual([
      { profileId: "staff-1", role: "STAFF" },
      { profileId: "admin-1", role: "TENANT_ADMIN" },
    ]);
    expect(result?.appointment).toEqual({ id: "appt-1", serviceName: "Saç kesimi", startAt: at, timeZone: "Europe/Istanbul" });
    expect(findMany.mock.calls[0][0].where.tenantId).toBe("tenant-a");
    expect(appointmentFind.mock.calls[0][0].where).toEqual({ tenantId_id: { tenantId: "tenant-a", id: "appt-1" } });
    expect(JSON.stringify(appointmentFind.mock.calls[0][0].select)).not.toMatch(/customer|phone|email|displayName/i);
  });

  it("skips INACTIVE assigned staff", async () => {
    const { prisma } = routing({ profileId: "staff-1", status: "INACTIVE" }, [
      { profileId: "admin-1", role: "TENANT_ADMIN" }, { profileId: "staff-1", role: "STAFF" },
    ]);
    expect((await readPushRecipients(prisma, tenant, "appt-1"))?.recipients).toEqual([{ profileId: "admin-1", role: "TENANT_ADMIN" }]);
  });

  it("skips assigned staff whose membership was removed", async () => {
    const { prisma } = routing({ profileId: "staff-1", status: "ACTIVE" }, [{ profileId: "admin-1", role: "TENANT_ADMIN" }]);
    expect((await readPushRecipients(prisma, tenant, "appt-1"))?.recipients).toEqual([{ profileId: "admin-1", role: "TENANT_ADMIN" }]);
  });

  it("an admin with an INACTIVE staff row still gets one admin push (admin wins, deduped)", async () => {
    const { prisma } = routing({ profileId: "admin-1", status: "INACTIVE" }, [{ profileId: "admin-1", role: "TENANT_ADMIN" }]);
    expect((await readPushRecipients(prisma, tenant, "appt-1"))?.recipients).toEqual([{ profileId: "admin-1", role: "TENANT_ADMIN" }]);
  });

  it("returns null when the appointment is not visible in the tenant", async () => {
    const { prisma, appointmentFind } = routing({ profileId: "staff-1", status: "ACTIVE" }, []);
    appointmentFind.mockResolvedValue(null);
    await expect(readPushRecipients(prisma, tenant, "appt-x")).resolves.toBeNull();
  });
});
