// ADR-045 phase B: pure planning for Google Calendar two-way sync. No I/O.

import type { FeedAppointment } from "./calendar-feed";
import { feedEventTitle } from "./calendar-feed";

/** Narrowest scopes: write only the calendar the app creates, read only free/busy elsewhere. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "openid",
  "email",
] as const;

/** Window kept in sync both ways (same as the subscription feed for the past, shorter ahead). */
export const SYNC_PAST_DAYS = 7;
export const SYNC_FUTURE_DAYS = 90;
/** A connection is synced again when its last sync is older than this. */
export const SYNC_STALE_MS = 5 * 60_000;
/** Busy blocks older than this are not trusted for online booking (sync failing for hours). */
export const BUSY_TRUST_MS = 6 * 60 * 60_000;

export function syncWindow(now: Date): Readonly<{ from: Date; to: Date }> {
  const day = 24 * 60 * 60_000;
  return { from: new Date(now.getTime() - SYNC_PAST_DAYS * day), to: new Date(now.getTime() + SYNC_FUTURE_DAYS * day) };
}

export type GoogleEventBody = Readonly<{
  summary: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
  status: "confirmed" | "tentative";
  extendedProperties: { private: { randevunAppointmentId: string } };
  source?: { title: string; url: string };
}>;

export function googleEventBody(appointment: FeedAppointment, appUrl: string | null): GoogleEventBody {
  return {
    summary: feedEventTitle(appointment),
    description: appointment.status === "PENDING" ? "Onay bekliyor" : appointment.status === "COMPLETED" ? "Tamamlandı" : "Onaylandı",
    start: { dateTime: appointment.startAt.toISOString() },
    end: { dateTime: appointment.endAt.toISOString() },
    status: appointment.status === "PENDING" ? "tentative" : "confirmed",
    extendedProperties: { private: { randevunAppointmentId: appointment.id } },
    ...(appUrl ? { source: { title: "RandevuN", url: appUrl } } : {}),
  };
}

export type EventLink = Readonly<{ appointmentId: string; externalEventId: string; syncedUpdatedAt: Date }>;

export type OutboundPlan = Readonly<{
  create: FeedAppointment[];
  update: Array<{ appointment: FeedAppointment; externalEventId: string }>;
  remove: EventLink[];
}>;

/**
 * What to write to the app's Google calendar: new appointments are created, changed ones
 * (updatedAt moved) are patched, and links whose appointment left the live set are deleted.
 */
export function planOutbound(appointments: readonly FeedAppointment[], links: readonly EventLink[]): OutboundPlan {
  const byAppointment = new Map(links.map((link) => [link.appointmentId, link]));
  const live = new Set(appointments.map((a) => a.id));
  const create: FeedAppointment[] = [];
  const update: Array<{ appointment: FeedAppointment; externalEventId: string }> = [];
  for (const appointment of appointments) {
    const link = byAppointment.get(appointment.id);
    if (!link) create.push(appointment);
    else if (link.syncedUpdatedAt.getTime() !== appointment.updatedAt.getTime()) update.push({ appointment, externalEventId: link.externalEventId });
  }
  return { create, update, remove: links.filter((link) => !live.has(link.appointmentId)) };
}

export type Interval = Readonly<{ startAt: Date; endAt: Date }>;

/** Sorted, merged busy intervals (Google returns them per calendar, possibly overlapping). */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.endAt.getTime() > i.startAt.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const merged: Array<{ startAt: Date; endAt: Date }> = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startAt.getTime() <= last.endAt.getTime()) {
      if (interval.endAt.getTime() > last.endAt.getTime()) last.endAt = interval.endAt;
    } else {
      merged.push({ startAt: interval.startAt, endAt: interval.endAt });
    }
  }
  return merged;
}

/**
 * Busy time that comes from the app's own events must not block the app: subtract the live
 * appointments (they are already conflicts on their own) so a mirrored event never double-counts.
 */
export function subtractIntervals(busy: readonly Interval[], own: readonly Interval[]): Interval[] {
  let result: Interval[] = mergeIntervals(busy);
  for (const cut of mergeIntervals(own)) {
    const next: Interval[] = [];
    for (const b of result) {
      if (cut.endAt <= b.startAt || cut.startAt >= b.endAt) {
        next.push(b);
        continue;
      }
      if (cut.startAt > b.startAt) next.push({ startAt: b.startAt, endAt: cut.startAt });
      if (cut.endAt < b.endAt) next.push({ startAt: cut.endAt, endAt: b.endAt });
    }
    result = next;
  }
  return result;
}
