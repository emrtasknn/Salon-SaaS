import type { PushNotificationRepository } from "../application/notification-service";
import type { PushSubscriptionRepository } from "../application/push-subscriptions";
import type { TenantContext } from "../domain/tenant-context";
import {
  subscriptionUpdateFor,
  WEB_PUSH_MAX_DEVICES_PER_RECIPIENT,
  WEB_PUSH_MAX_TRANSIENT_FAILURES,
} from "../domain/web-push";
import { readPushRecipients } from "./prisma-notification";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

// WP-09 PushSubscription access. Every query runs inside withPrismaTenantContext
// (RLS app.tenant_id) and also filters on the trusted tenantId (defence in depth).
// Rows are never deleted here: unsubscribe / 404 / 410 / repeated failures set revokedAt.

type PushTx = PrismaTenantTransactionClient & {
  tenant: { findUnique(args: { where: { id: string }; select: { status: true } }): Promise<{ status: "ACTIVE" | "INACTIVE" } | null> };
  staff: {
    findUnique(args: { where: { tenantId_profileId: { tenantId: string; profileId: string } }; select: { status: true } }):
      Promise<{ status: "ACTIVE" | "INACTIVE" } | null>;
  };
  pushSubscription: {
    upsert(args: { where: { tenantId_endpoint: { tenantId: string; endpoint: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; endpoint: true; p256dh: true; auth: true };
      orderBy: { lastSeenAt: "desc" };
      take: number;
    }): Promise<Array<{ id: string; endpoint: string; p256dh: string; auth: string }>>;
  };
};

export function createPrismaPushSubscriptionRepository(prisma: PrismaTenantClient): PushSubscriptionRepository {
  return {
    async readEligibility(tenantContext, profileId) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: PushTx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantContext.tenantId }, select: { status: true } });
        const staff = await tx.staff.findUnique({
          where: { tenantId_profileId: { tenantId: tenantContext.tenantId, profileId } },
          select: { status: true },
        });
        return { tenantStatus: tenant?.status ?? null, staffStatus: staff?.status ?? null };
      });
    },

    async upsert(tenantContext, input) {
      await withPrismaTenantContext(prisma, tenantContext, async (tx: PushTx) => {
        // Per-tenant unique endpoint: re-subscribing reassigns the device to the latest profile.
        await tx.pushSubscription.upsert({
          where: { tenantId_endpoint: { tenantId: tenantContext.tenantId, endpoint: input.endpoint } },
          create: {
            tenantId: tenantContext.tenantId,
            profileId: input.profileId,
            endpoint: input.endpoint,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent,
            lastSeenAt: input.at,
          },
          update: {
            profileId: input.profileId,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent,
            revokedAt: null,
            failureCount: 0,
            lastSeenAt: input.at,
          },
        });
      });
    },

    async revoke(tenantContext, input) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: PushTx) => {
        const result = await tx.pushSubscription.updateMany({
          where: { tenantId: tenantContext.tenantId, endpoint: input.endpoint, profileId: input.profileId, revokedAt: null },
          data: { revokedAt: input.at },
        });
        return result.count;
      });
    },
  };
}

export function createPrismaPushNotificationRepository(prisma: PrismaTenantClient): PushNotificationRepository {
  return {
    pushRecipients(tenantContext, appointmentId) {
      return readPushRecipients(prisma, tenantContext, appointmentId);
    },

    async activeSubscriptions(tenantContext, profileId) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: PushTx) =>
        tx.pushSubscription.findMany({
          where: { tenantId: tenantContext.tenantId, profileId, revokedAt: null },
          select: { id: true, endpoint: true, p256dh: true, auth: true },
          orderBy: { lastSeenAt: "desc" },
          take: WEB_PUSH_MAX_DEVICES_PER_RECIPIENT,
        }));
    },

    async recordPushResult(tenantContext: TenantContext, input) {
      const update = subscriptionUpdateFor(input.outcome);
      if (update === "none") return;
      await withPrismaTenantContext(prisma, tenantContext, async (tx: PushTx) => {
        const where = { tenantId: tenantContext.tenantId, id: input.subscriptionId, revokedAt: null };
        if (update === "reset_failures") {
          await tx.pushSubscription.updateMany({ where, data: { failureCount: 0, lastSuccessAt: input.at } });
          return;
        }
        if (update === "revoke") {
          await tx.pushSubscription.updateMany({ where, data: { revokedAt: input.at, lastFailureAt: input.at } });
          return;
        }
        // Atomic increment, then revoke once the threshold is reached (ADR-044 §10-6).
        await tx.pushSubscription.updateMany({ where, data: { failureCount: { increment: 1 }, lastFailureAt: input.at } });
        await tx.pushSubscription.updateMany({
          where: { ...where, failureCount: { gte: WEB_PUSH_MAX_TRANSIENT_FAILURES } },
          data: { revokedAt: input.at },
        });
      });
    },
  };
}
