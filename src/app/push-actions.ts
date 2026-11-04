"use server";

import { readAuthenticatedTenantRequest } from "../application/auth-request-boundary";
import { createPushSubscriptions, type PushSession } from "../application/push-subscriptions";
import { readVapidConfig } from "../domain/web-push";
import { createNextSupabaseServerClient } from "../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../infrastructure/auth/supabase-server-env";
import { logError } from "../infrastructure/log-redaction";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaMembershipReader } from "../persistence/prisma-membership-reader";
import { createPrismaPushSubscriptionRepository } from "../persistence/prisma-push-subscription";

/**
 * WP-09 Web Push subscription actions (ADR-044 §4.2). Tenant and profile come only
 * from the authenticated session + membership; no tenant/profile id is read from input.
 * Node runtime (default for server actions); web-push is never used on Edge.
 */

type SessionResult = PushSession | "UNAUTHORIZED" | "FORBIDDEN";

async function readPushSession(): Promise<SessionResult> {
  const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
  const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
  if (request.state !== "authenticated") return "UNAUTHORIZED";
  const reader = createPrismaMembershipReader({ prisma: getPrisma() });
  const membership = await reader.readMembership({ tenantContext: request.tenantContext, identity: request.identity });
  if (membership.status !== "found") return "FORBIDDEN";
  return {
    tenantContext: request.tenantContext,
    profileId: membership.membership.profileId,
    role: membership.membership.role,
  };
}

function service() {
  return createPushSubscriptions({
    repository: createPrismaPushSubscriptionRepository(getPrisma()),
    configured: readVapidConfig(process.env) !== null,
  });
}

/** VAPID public key served at runtime (not NEXT_PUBLIC_*); only to STAFF / TENANT_ADMIN sessions. */
export async function getWebPushConfigAction(): Promise<{ enabled: false } | { enabled: true; publicKey: string }> {
  try {
    const config = readVapidConfig(process.env);
    if (!config) return { enabled: false };
    const session = await readPushSession();
    if (typeof session === "string" || (session.role !== "STAFF" && session.role !== "TENANT_ADMIN")) return { enabled: false };
    return { enabled: true, publicKey: config.publicKey };
  } catch {
    return { enabled: false };
  }
}

export async function subscribeWebPushAction(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}): Promise<{ status: "subscribed" } | { status: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" | "NOT_CONFIGURED" }> {
  try {
    return await service().subscribe(await readPushSession(), input);
  } catch {
    // Fail closed inside the fixed contract; no endpoint/keys in the log.
    logError("web_push_subscribe_failed", { errorCode: "WEB_PUSH_SUBSCRIBE_FAILED" });
    return { status: "FORBIDDEN" };
  }
}

export async function unsubscribeWebPushAction(input: { endpoint: string }): Promise<{ status: "revoked" | "not_found" | "UNAUTHORIZED" }> {
  try {
    const session = await readPushSession();
    // A member whose membership is gone has nothing left to revoke under this tenant.
    if (session === "FORBIDDEN") return { status: "not_found" };
    return await service().unsubscribe(session, input);
  } catch {
    logError("web_push_unsubscribe_failed", { errorCode: "WEB_PUSH_UNSUBSCRIBE_FAILED" });
    return { status: "not_found" };
  }
}
