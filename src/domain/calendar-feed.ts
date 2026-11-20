import { createHash, randomBytes } from "node:crypto";
import { escapeIcsText, foldIcsLine, formatCalendarUtc } from "./calendar-event";

// ADR-045 phase A: private iCalendar subscription feed. Only the SHA-256 hash of the token is
// stored; the raw token lives in the subscription URL and must never be logged.

export type CalendarFeedScope = "STAFF_SELF" | "TENANT_ALL";

const TOKEN_BYTES = 32;
const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Appointments from 30 days back to 180 days ahead are in the feed. */
export const FEED_PAST_DAYS = 30;
export const FEED_FUTURE_DAYS = 180;
/** Hint for calendar apps; Apple honours it, Google refreshes on its own schedule. */
export const FEED_REFRESH_MINUTES = 15;
/** Live statuses shown in the feed; cancelled/rejected disappear from the phone calendar. */
export const FEED_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED"] as const;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function generateCalendarFeedToken(): Readonly<{ token: string; tokenHash: string }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

/** Hash of a well-formed raw token (an optional ".ics" suffix is allowed), or null. */
export function hashCalendarFeedToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.endsWith(".ics") ? value.slice(0, -4) : value;
  return RAW_TOKEN.test(token) ? sha256Hex(token) : null;
}

export function feedWindow(now: Date): Readonly<{ from: Date; to: Date }> {
  const day = 24 * 60 * 60_000;
  return { from: new Date(now.getTime() - FEED_PAST_DAYS * day), to: new Date(now.getTime() + FEED_FUTURE_DAYS * day) };
}

/** Path of the feed on this app: /<slug>/takvim/<token>.ics */
export function calendarFeedPath(slug: string, token: string): string {
  return `/${encodeURIComponent(slug)}/takvim/${token}.ics`;
}

export type FeedAppointment = Readonly<{
  id: string;
  startAt: Date;
  endAt: Date;
  status: string;
  customerName: string;
  serviceLabel: string;
  /** Shown for the whole-salon (TENANT_ALL) feed. */
  staffName: string | null;
  updatedAt: Date;
}>;

const STATUS_PREFIX: Record<string, string> = { PENDING: "⏳ ", COMPLETED: "✓ " };
const STATUS_LABEL: Record<string, string> = { PENDING: "Onay bekliyor", CONFIRMED: "Onaylandı", COMPLETED: "Tamamlandı" };

/** Event title as it shows in the phone calendar: "Ayşe Yılmaz — Saç kesimi". */
export function feedEventTitle(appointment: FeedAppointment): string {
  const staff = appointment.staffName ? ` (${appointment.staffName})` : "";
  return `${STATUS_PREFIX[appointment.status] ?? ""}${appointment.customerName} — ${appointment.serviceLabel}${staff}`;
}

/**
 * Whole feed as one VCALENDAR (CRLF, folded). UID = appointment id so a changed appointment
 * updates the existing event; SEQUENCE follows updatedAt so clients notice the change.
 */
export function buildCalendarFeed(input: {
  calendarName: string;
  appointments: readonly FeedAppointment[];
  now: Date;
  appUrl: string | null;
}): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RandevuN//Takvim//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(input.calendarName)}`,
    "X-WR-TIMEZONE:Europe/Istanbul",
    `REFRESH-INTERVAL;VALUE=DURATION:PT${FEED_REFRESH_MINUTES}M`,
    `X-PUBLISHED-TTL:PT${FEED_REFRESH_MINUTES}M`,
  ];
  for (const appointment of input.appointments) {
    const description = [`Durum: ${STATUS_LABEL[appointment.status] ?? appointment.status}`, ...(appointment.staffName ? [`Personel: ${appointment.staffName}`] : [])];
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(`${appointment.id}@randevun`)}`,
      `DTSTAMP:${formatCalendarUtc(input.now)}`,
      `LAST-MODIFIED:${formatCalendarUtc(appointment.updatedAt)}`,
      `SEQUENCE:${Math.floor(appointment.updatedAt.getTime() / 1000)}`,
      `DTSTART:${formatCalendarUtc(appointment.startAt)}`,
      `DTEND:${formatCalendarUtc(appointment.endAt)}`,
      `STATUS:${appointment.status === "PENDING" ? "TENTATIVE" : "CONFIRMED"}`,
      `SUMMARY:${escapeIcsText(feedEventTitle(appointment))}`,
      `DESCRIPTION:${escapeIcsText(description.join("\n"))}`,
      ...(input.appUrl ? [`URL:${input.appUrl}`] : []),
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
