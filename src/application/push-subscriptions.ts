import type { TenantContext } from "../domain/tenant-context";
import { validatePushEndpoint, validatePushSubscriptionInput } from "../domain/web-push";

// WP-09 subscribe / unsubscribe (ADR-044 §4.2). Tenant and profile come only from
// the authenticated session resolved by the caller; the client sends nothing but
// the browser PushSubscription JSON.

export type PushSession = Readonly<{
  tenantContext: TenantContext;
  profileId: string;
  role: "SUPER_ADMIN" | "TENANT_ADMIN" | "STAFF" | "CUSTOMER";
}>;

export type PushSubscriptionRepository = Readonly<{
  readEligibility(
    tenantContext: TenantContext,
    profileId: string,
  ): Promise<Readonly<{ tenantStatus: "ACTIVE" | "INACTIVE" | null; staffStatus: "ACTIVE" | "INACTIVE" | null }>>;
  upsert(
    tenantContext: TenantContext,
    input: Readonly<{ profileId: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null; at: Date }>,
  ): Promise<void>;
  /** Revokes the caller's own row for this endpoint; returns the number of rows revoked. */
  revoke(tenantContext: TenantContext, input: Readonly<{ profileId: string; endpoint: string; at: Date }>): Promise<number>;
}>;

export type SubscribeResult = { status: "subscribed" } | { status: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" | "NOT_CONFIGURED" };
export type UnsubscribeResult = { status: "revoked" | "not_found" | "UNAUTHORIZED" };

export function createPushSubscriptions(dependencies: Readonly<{
  repository: PushSubscriptionRepository;
  configured: boolean;
  now?: () => Date;
}>) {
  const now = dependencies.now ?? (() => new Date());
  return {
    async subscribe(session: PushSession | "UNAUTHORIZED" | "FORBIDDEN", input: unknown): Promise<SubscribeResult> {
      if (session === "UNAUTHORIZED" || session === "FORBIDDEN") return { status: session };
      if (session.role !== "STAFF" && session.role !== "TENANT_ADMIN") return { status: "FORBIDDEN" };
      if (!dependencies.configured) return { status: "NOT_CONFIGURED" };
      const subscription = validatePushSubscriptionInput(input);
      if (!subscription) return { status: "INVALID" };
      const eligibility = await dependencies.repository.readEligibility(session.tenantContext, session.profileId);
      // Fail closed: inactive or invisible tenant, or STAFF without an ACTIVE Staff row.
      if (eligibility.tenantStatus !== "ACTIVE") return { status: "FORBIDDEN" };
      if (session.role === "STAFF" && eligibility.staffStatus !== "ACTIVE") return { status: "FORBIDDEN" };
      await dependencies.repository.upsert(session.tenantContext, {
        profileId: session.profileId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        userAgent: subscription.userAgent,
        at: now(),
      });
      return { status: "subscribed" };
    },

    /** Any authenticated member may revoke their own device (logout cleanup), whatever their status. */
    async unsubscribe(session: PushSession | "UNAUTHORIZED", input: unknown): Promise<UnsubscribeResult> {
      if (session === "UNAUTHORIZED") return { status: "UNAUTHORIZED" };
      const endpoint = typeof input === "object" && input !== null
        ? validatePushEndpoint((input as Record<string, unknown>).endpoint)
        : null;
      if (!endpoint) return { status: "not_found" };
      const revoked = await dependencies.repository.revoke(session.tenantContext, { profileId: session.profileId, endpoint, at: now() });
      return { status: revoked > 0 ? "revoked" : "not_found" };
    },
  };
}
