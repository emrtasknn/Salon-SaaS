"use server";

import { headers } from "next/headers";

import { readAuthenticatedTenantRequest } from "../application/auth-request-boundary";
import { calendarFeedPath, type CalendarFeedScope } from "../domain/calendar-feed";
import { createNextSupabaseServerClient } from "../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../infrastructure/auth/supabase-server-env";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaMembershipReader } from "../persistence/prisma-membership-reader";
import { findStaffByProfileId } from "../persistence/prisma-staff-lookup";
import { calendarFeedService } from "./calendar-feed-runtime";

// ADR-045 settings actions: show, create and turn off the signed-in user's own calendar link.
// Tenant and profile always come from the session; the client only names a scope, which is
// checked against the user's current role here.

export type CalendarFeedView =
  | Readonly<{ status: "ok"; active: boolean; createdAt: string | null; lastUsedAt: string | null }>
  | Readonly<{ status: "UNAUTHORIZED" }>;

export type CalendarFeedLinkView =
  | Readonly<{ status: "ok"; webcalUrl: string; httpsUrl: string; googleUrl: string }>
  | Readonly<{ status: "UNAUTHORIZED" }>;

function isScope(value: unknown): value is CalendarFeedScope {
  return value === "STAFF_SELF" || value === "TENANT_ALL";
}

async function feedContext(scope: unknown) {
  if (!isScope(scope)) return null;
  const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
  const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
  if (request.state !== "authenticated") return null;
  const prisma = getPrisma();
  const membership = await createPrismaMembershipReader({ prisma }).readMembership({ tenantContext: request.tenantContext, identity: request.identity });
  if (membership.status !== "found") return null;
  const { role, profileId } = membership.membership;
  if (scope === "TENANT_ALL") {
    if (role !== "TENANT_ADMIN" && role !== "SUPER_ADMIN") return null;
  } else {
    if (role !== "STAFF" && role !== "TENANT_ADMIN") return null;
    const staff = await findStaffByProfileId(prisma, request.tenantContext, profileId);
    if (!staff || staff.status !== "ACTIVE") return null;
  }
  return { prisma, tenantContext: request.tenantContext, profileId, scope };
}

async function origin(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function getCalendarFeedStatus(scope: CalendarFeedScope): Promise<CalendarFeedView> {
  const context = await feedContext(scope);
  if (!context) return { status: "UNAUTHORIZED" };
  const status = await calendarFeedService(null).status(context.tenantContext, context.profileId, context.scope);
  return { status: "ok", active: status.active, createdAt: status.createdAt?.toISOString() ?? null, lastUsedAt: status.lastUsedAt?.toISOString() ?? null };
}

/** Creates a new link (the previous one stops working) and returns it once; only its hash is stored. */
export async function createCalendarFeedLink(scope: CalendarFeedScope): Promise<CalendarFeedLinkView> {
  const context = await feedContext(scope);
  if (!context) return { status: "UNAUTHORIZED" };
  const base = await origin();
  if (!base) return { status: "UNAUTHORIZED" };
  const tenant = await context.prisma.tenant.findUnique({ where: { id: context.tenantContext.tenantId }, select: { slug: true } });
  if (!tenant) return { status: "UNAUTHORIZED" };
  const token = await calendarFeedService(base).issue(context.tenantContext, context.profileId, context.scope, new Date());
  const httpsUrl = `${base}${calendarFeedPath(tenant.slug, token)}`;
  const webcalUrl = httpsUrl.replace(/^https?:/, "webcal:");
  return { status: "ok", httpsUrl, webcalUrl, googleUrl: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}` };
}

export async function revokeCalendarFeedLink(scope: CalendarFeedScope): Promise<CalendarFeedView> {
  const context = await feedContext(scope);
  if (!context) return { status: "UNAUTHORIZED" };
  await calendarFeedService(null).revoke(context.tenantContext, context.profileId, context.scope, new Date());
  return { status: "ok", active: false, createdAt: null, lastUsedAt: null };
}
