// ADR-045 phase B: Google Calendar two-way sync for one connection.
// Outbound: live appointments → events in the calendar the app created.
// Inbound: free/busy of the chosen calendars → ExternalBusyBlock rows for the staff member,
// used only by online booking. Tenant and holder always come from the stored connection.

import type { FeedAppointment } from "../domain/calendar-feed";
import {
  googleEventBody,
  planOutbound,
  subtractIntervals,
  syncWindow,
  type EventLink,
  type GoogleEventBody,
  type Interval,
} from "../domain/google-calendar-sync";
import type { TenantContext } from "../domain/tenant-context";
import type { FeedHolder } from "./calendar-feed";

export type StoredConnection = Readonly<{
  id: string;
  profileId: string;
  status: "ACTIVE" | "ERROR" | "REVOKED";
  refreshTokenEnc: string;
  calendarId: string;
  busyCalendarIds: readonly string[];
  accountEmail: string | null;
  lastSyncAt: Date | null;
  lastErrorCode: string | null;
}>;

export interface CalendarSyncRepository {
  findLive(tenantContext: TenantContext, profileId: string): Promise<StoredConnection | null>;
  listStale(tenantContext: TenantContext, olderThan: Date, limit: number): Promise<StoredConnection[]>;
  findLiveForStaff(tenantContext: TenantContext, staffId: string): Promise<StoredConnection | null>;
  create(tenantContext: TenantContext, input: { profileId: string; refreshTokenEnc: string; calendarId: string; accountEmail: string | null }): Promise<void>;
  revoke(tenantContext: TenantContext, connectionId: string, now: Date): Promise<void>;
  markSynced(tenantContext: TenantContext, connectionId: string, input: { now: Date; errorCode: string | null; status: "ACTIVE" | "ERROR" | "REVOKED" }): Promise<void>;
  /** Links whose appointment starts inside [from, to) (older ones are left alone). */
  listLinks(tenantContext: TenantContext, connectionId: string, window: { from: Date; to: Date }): Promise<EventLink[]>;
  saveLink(tenantContext: TenantContext, connectionId: string, link: EventLink): Promise<void>;
  deleteLink(tenantContext: TenantContext, connectionId: string, appointmentId: string): Promise<void>;
  replaceBusy(tenantContext: TenantContext, input: { connectionId: string; staffId: string; from: Date; to: Date; blocks: readonly Interval[] }): Promise<void>;
  readHolder(tenantContext: TenantContext, profileId: string): Promise<FeedHolder>;
  listAppointments(tenantContext: TenantContext, input: { staffId: string | null; from: Date; to: Date }): Promise<FeedAppointment[]>;
}

export interface GooglePort {
  refreshAccessToken(refreshToken: string): Promise<string>;
  insertEvent(accessToken: string, calendarId: string, body: GoogleEventBody): Promise<string>;
  patchEvent(accessToken: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<void>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  freeBusy(accessToken: string, calendarIds: readonly string[], from: Date, to: Date): Promise<Interval[]>;
}

export type SyncOutcome =
  | Readonly<{ status: "synced"; created: number; updated: number; removed: number; busyBlocks: number; failures: number }>
  | Readonly<{ status: "revoked" | "error"; code: string }>;

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code.slice(0, 60) : "unknown";
}

export function createCalendarSync(deps: {
  repository: CalendarSyncRepository;
  google: GooglePort;
  decrypt: (value: string) => string | null;
  appUrl: string | null;
}) {
  const { repository, google } = deps;

  async function sync(tenantContext: TenantContext, connection: StoredConnection, now: Date): Promise<SyncOutcome> {
    const holder = await repository.readHolder(tenantContext, connection.profileId);
    const isAdmin = holder.role === "TENANT_ADMIN" || holder.role === "SUPER_ADMIN";
    const staffId = holder.staffActive ? holder.staffId : null;
    // A removed member, or a staff member without an active staff row, loses the connection.
    if (!isAdmin && !staffId) {
      await repository.revoke(tenantContext, connection.id, now);
      return { status: "revoked", code: "holder_inactive" };
    }

    const refreshToken = deps.decrypt(connection.refreshTokenEnc);
    if (!refreshToken) {
      await repository.markSynced(tenantContext, connection.id, { now, errorCode: "token_unreadable", status: "ERROR" });
      return { status: "error", code: "token_unreadable" };
    }
    let accessToken: string;
    try {
      accessToken = await google.refreshAccessToken(refreshToken);
    } catch (error) {
      const code = errorCode(error);
      // invalid_grant = the user removed access in their Google account: stop for good.
      const status = code === "invalid_grant" ? "REVOKED" : "ERROR";
      await repository.markSynced(tenantContext, connection.id, { now, errorCode: code, status });
      return { status: status === "REVOKED" ? "revoked" : "error", code };
    }

    const { from, to } = syncWindow(now);
    // Staff: own appointments. Admin who does not serve customers: the whole salon.
    const appointments = await repository.listAppointments(tenantContext, { staffId, from, to });
    const links = await repository.listLinks(tenantContext, connection.id, { from, to });
    const plan = planOutbound(appointments.map((a) => (staffId ? { ...a, staffName: null } : a)), links);
    let failures = 0;
    const appUrl = deps.appUrl;
    for (const appointment of plan.create) {
      try {
        const eventId = await google.insertEvent(accessToken, connection.calendarId, googleEventBody(appointment, appUrl));
        await repository.saveLink(tenantContext, connection.id, { appointmentId: appointment.id, externalEventId: eventId, syncedUpdatedAt: appointment.updatedAt });
      } catch {
        failures++;
      }
    }
    for (const { appointment, externalEventId } of plan.update) {
      try {
        await google.patchEvent(accessToken, connection.calendarId, externalEventId, googleEventBody(appointment, appUrl));
        await repository.saveLink(tenantContext, connection.id, { appointmentId: appointment.id, externalEventId, syncedUpdatedAt: appointment.updatedAt });
      } catch {
        failures++;
      }
    }
    for (const link of plan.remove) {
      try {
        await google.deleteEvent(accessToken, connection.calendarId, link.externalEventId);
        await repository.deleteLink(tenantContext, connection.id, link.appointmentId);
      } catch {
        failures++;
      }
    }

    let busyBlocks = 0;
    if (staffId) {
      try {
        const busy = await google.freeBusy(accessToken, connection.busyCalendarIds, now, to);
        const own = appointments.map((a) => ({ startAt: a.startAt, endAt: a.endAt }));
        const blocks = subtractIntervals(busy, own);
        await repository.replaceBusy(tenantContext, { connectionId: connection.id, staffId, from: now, to, blocks });
        busyBlocks = blocks.length;
      } catch {
        failures++;
      }
    }

    await repository.markSynced(tenantContext, connection.id, { now, errorCode: failures ? "partial" : null, status: "ACTIVE" });
    return { status: "synced", created: plan.create.length, updated: plan.update.length, removed: plan.remove.length, busyBlocks, failures };
  }

  return {
    sync,
    /** Syncs up to `limit` connections of the tenant whose last sync is older than `olderThan`. */
    async syncStale(tenantContext: TenantContext, olderThan: Date, now: Date, limit = 3) {
      const stale = await repository.listStale(tenantContext, olderThan, limit);
      const outcomes: SyncOutcome[] = [];
      for (const connection of stale) {
        try {
          outcomes.push(await sync(tenantContext, connection, now));
        } catch (error) {
          outcomes.push({ status: "error", code: errorCode(error) });
        }
      }
      return outcomes;
    },
  };
}
