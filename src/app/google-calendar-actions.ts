"use server";

import { createGoogleCalendarHttp } from "../infrastructure/google-calendar-http";
import { decryptSecret } from "../infrastructure/calendar-token-crypto";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaCalendarSyncRepository } from "../persistence/prisma-calendar-sync";
import { calendarSyncService, googleSyncConfig } from "./calendar-sync-runtime";
import { readSessionMember } from "./session-member";

// ADR-045 phase B settings actions for the signed-in user's own Google connection. Tenant and
// profile come from the session only.

export type GoogleCalendarView =
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "UNAUTHORIZED" }>
  | Readonly<{
      status: "ok";
      connected: boolean;
      accountEmail: string | null;
      lastSyncAt: string | null;
      health: "ok" | "error" | "revoked" | null;
      busyApplies: boolean;
    }>;

async function context() {
  if (!googleSyncConfig()) return "unavailable" as const;
  const member = await readSessionMember();
  if (!member || (!member.isAdmin && !member.activeStaffId)) return null;
  return member;
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarView> {
  const member = await context();
  if (member === "unavailable") return { status: "unavailable" };
  if (!member) return { status: "UNAUTHORIZED" };
  const connection = await createPrismaCalendarSyncRepository(getPrisma()).findLive(member.tenantContext, member.profileId);
  return {
    status: "ok",
    connected: connection !== null,
    accountEmail: connection?.accountEmail ?? null,
    lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
    health: connection ? (connection.status === "ERROR" ? "error" : connection.lastErrorCode === "partial" ? "error" : "ok") : null,
    busyApplies: member.activeStaffId !== null,
  };
}

export async function syncGoogleCalendarNow(): Promise<GoogleCalendarView> {
  const member = await context();
  if (member === "unavailable") return { status: "unavailable" };
  if (!member) return { status: "UNAUTHORIZED" };
  const repository = createPrismaCalendarSyncRepository(getPrisma());
  const connection = await repository.findLive(member.tenantContext, member.profileId);
  const service = calendarSyncService();
  if (connection && service) await service.sync(member.tenantContext, connection, new Date());
  return getGoogleCalendarStatus();
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarView> {
  const member = await context();
  const config = googleSyncConfig();
  if (member === "unavailable" || !config) return { status: "unavailable" };
  if (!member) return { status: "UNAUTHORIZED" };
  const repository = createPrismaCalendarSyncRepository(getPrisma());
  const connection = await repository.findLive(member.tenantContext, member.profileId);
  if (connection) {
    await repository.revoke(member.tenantContext, connection.id, new Date());
    // Best effort: also withdraw the app's access in the user's Google account.
    const refreshToken = decryptSecret(connection.refreshTokenEnc, config.key);
    if (refreshToken) await createGoogleCalendarHttp(config.oauth).revoke(refreshToken);
  }
  return getGoogleCalendarStatus();
}
