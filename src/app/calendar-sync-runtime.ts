import "server-only";

import { after } from "next/server";

import { createCalendarSync } from "../application/calendar-sync";
import { SYNC_STALE_MS } from "../domain/google-calendar-sync";
import type { TenantContext } from "../domain/tenant-context";
import { decryptSecret, readCalendarTokenKey } from "../infrastructure/calendar-token-crypto";
import { createGoogleCalendarHttp, readGoogleOAuthConfig } from "../infrastructure/google-calendar-http";
import { logInfo } from "../infrastructure/log-redaction";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaCalendarSyncRepository } from "../persistence/prisma-calendar-sync";

/** Google sync is on only when the OAuth client and the token key are configured (Vercel env). */
export function googleSyncConfig() {
  const oauth = readGoogleOAuthConfig();
  const key = readCalendarTokenKey();
  return oauth && key ? { oauth, key } : null;
}

export function calendarSyncService(appUrl: string | null = null) {
  const config = googleSyncConfig();
  if (!config) return null;
  return createCalendarSync({
    repository: createPrismaCalendarSyncRepository(getPrisma()),
    google: createGoogleCalendarHttp(config.oauth),
    decrypt: (value) => decryptSecret(value, config.key),
    appUrl,
  });
}

/**
 * After the response is sent, syncs a few connections of this tenant whose last sync is older
 * than five minutes. Called when calendars or online slots are viewed, so both directions stay
 * fresh without a cron job. Never blocks or fails the request.
 */
export function syncStaleCalendarsLater(tenantContext: TenantContext) {
  const service = calendarSyncService();
  if (!service) return;
  after(async () => {
    try {
      const now = new Date();
      const outcomes = await service.syncStale(tenantContext, new Date(now.getTime() - SYNC_STALE_MS), now);
      for (const outcome of outcomes) {
        if (outcome.status !== "synced" || outcome.failures) logInfo("calendar_sync_outcome", { status: outcome.status, code: "code" in outcome ? outcome.code : "partial" });
      }
    } catch {
      logInfo("calendar_sync_failed", {});
    }
  });
}
