// ADR-045 phase A: issue/revoke private calendar feed links and render a feed by token.
// Pure orchestration: persistence and rate limiting are injected. The tenant always comes
// from the server (session for issue/revoke, URL slug → tenant row for the feed), the
// profile from the session or the stored token row; never from client input.

import {
  buildCalendarFeed,
  feedWindow,
  generateCalendarFeedToken,
  hashCalendarFeedToken,
  type CalendarFeedScope,
  type FeedAppointment,
} from "../domain/calendar-feed";
import type { TenantContext } from "../domain/tenant-context";

export type FeedTokenRecord = Readonly<{ id: string; profileId: string; scope: CalendarFeedScope; lastUsedAt: Date | null }>;
export type FeedLinkStatus = Readonly<{ active: boolean; createdAt: Date | null; lastUsedAt: Date | null }>;

/** Who the token belongs to, as the database says now (membership/staff may have changed). */
export type FeedHolder = Readonly<{
  role: "SUPER_ADMIN" | "TENANT_ADMIN" | "STAFF" | "CUSTOMER" | null;
  staffId: string | null;
  staffActive: boolean;
}>;

export interface CalendarFeedRepository {
  /** Revokes the active token of (profile, scope) and stores the new hash, in one transaction. */
  replace(tenantContext: TenantContext, input: { profileId: string; scope: CalendarFeedScope; tokenHash: string; now: Date }): Promise<void>;
  revoke(tenantContext: TenantContext, input: { profileId: string; scope: CalendarFeedScope; now: Date }): Promise<void>;
  status(tenantContext: TenantContext, input: { profileId: string; scope: CalendarFeedScope }): Promise<FeedLinkStatus>;
  findActiveByHash(tenantContext: TenantContext, tokenHash: string): Promise<FeedTokenRecord | null>;
  readHolder(tenantContext: TenantContext, profileId: string): Promise<FeedHolder>;
  listAppointments(tenantContext: TenantContext, input: { staffId: string | null; from: Date; to: Date }): Promise<FeedAppointment[]>;
  touch(tenantContext: TenantContext, tokenId: string, now: Date): Promise<void>;
}

export type FeedTenant = Readonly<{ tenantContext: TenantContext; name: string }>;

export type FeedResult =
  | Readonly<{ status: "ok"; body: string }>
  | Readonly<{ status: "NOT_FOUND" }>
  | Readonly<{ status: "RATE_LIMITED" }>;

/** lastUsedAt is written at most this often (a phone polls every few minutes). */
const TOUCH_EVERY_MS = 60 * 60_000;

export function holderMayUse(scope: CalendarFeedScope, holder: FeedHolder): boolean {
  if (scope === "TENANT_ALL") return holder.role === "TENANT_ADMIN" || holder.role === "SUPER_ADMIN";
  return (holder.role === "STAFF" || holder.role === "TENANT_ADMIN") && holder.staffId !== null && holder.staffActive;
}

export function createCalendarFeedService(deps: {
  repository: CalendarFeedRepository;
  resolveTenantBySlug: (slug: string) => Promise<FeedTenant | null>;
  /** Per-IP limiter; "limited" ends the request with 429. */
  hit: (bucket: "feed.view" | "feed.miss") => Promise<"allowed" | "limited">;
  appUrl: (scope: CalendarFeedScope) => string | null;
}) {
  return {
    /** New link for the signed-in profile; the old link stops working. Returns the raw token once. */
    async issue(tenantContext: TenantContext, profileId: string, scope: CalendarFeedScope, now: Date) {
      const { token, tokenHash } = generateCalendarFeedToken();
      await deps.repository.replace(tenantContext, { profileId, scope, tokenHash, now });
      return token;
    },

    revoke(tenantContext: TenantContext, profileId: string, scope: CalendarFeedScope, now: Date) {
      return deps.repository.revoke(tenantContext, { profileId, scope, now });
    },

    status(tenantContext: TenantContext, profileId: string, scope: CalendarFeedScope) {
      return deps.repository.status(tenantContext, { profileId, scope });
    },

    async render(slug: string, rawToken: string, now: Date): Promise<FeedResult> {
      const tokenHash = hashCalendarFeedToken(rawToken);
      if (!tokenHash) {
        return (await deps.hit("feed.miss")) === "limited" ? { status: "RATE_LIMITED" } : { status: "NOT_FOUND" };
      }
      if ((await deps.hit("feed.view")) === "limited") return { status: "RATE_LIMITED" };
      const tenant = await deps.resolveTenantBySlug(slug);
      const token = tenant ? await deps.repository.findActiveByHash(tenant.tenantContext, tokenHash) : null;
      if (!tenant || !token) {
        return (await deps.hit("feed.miss")) === "limited" ? { status: "RATE_LIMITED" } : { status: "NOT_FOUND" };
      }
      // Re-checked on every fetch: a deactivated staff member or a removed admin loses the feed.
      const holder = await deps.repository.readHolder(tenant.tenantContext, token.profileId);
      if (!holderMayUse(token.scope, holder)) return { status: "NOT_FOUND" };

      const { from, to } = feedWindow(now);
      const appointments = await deps.repository.listAppointments(tenant.tenantContext, {
        staffId: token.scope === "STAFF_SELF" ? holder.staffId : null,
        from,
        to,
      });
      if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
        await deps.repository.touch(tenant.tenantContext, token.id, now);
      }
      const body = buildCalendarFeed({
        calendarName: token.scope === "TENANT_ALL" ? `${tenant.name} — Tüm randevular` : `${tenant.name} — Randevularım`,
        appointments: token.scope === "TENANT_ALL" ? appointments : appointments.map((a) => ({ ...a, staffName: null })),
        now,
        appUrl: deps.appUrl(token.scope),
      });
      return { status: "ok", body };
    },
  };
}
