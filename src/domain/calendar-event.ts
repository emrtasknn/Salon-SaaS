// Pure "add to calendar" builders for the customer status page: an RFC 5545 (.ics)
// document for Apple Calendar and other iCalendar apps, and a Google Calendar
// template link. No I/O; callers pass only data the customer already sees.

export type CalendarEvent = Readonly<{
  /** Stable per appointment so re-importing updates instead of duplicating. */
  uid: string;
  title: string;
  startAt: Date;
  endAt: Date;
  location: string | null;
  description: string;
  /** Customer status page link (also embedded in the description). */
  url: string;
  status: "CONFIRMED" | "TENTATIVE";
}>;

/** Minutes before the start at which the .ics VALARM fires. */
export const CALENDAR_ALARM_MINUTES_BEFORE = 60;

const pad = (value: number) => String(value).padStart(2, "0");

/** UTC "YYYYMMDDTHHMMSSZ" (iCalendar DATE-TIME form #2, also used by Google `dates`). */
export function formatCalendarUtc(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const MAX_LINE_OCTETS = 75;
const encoder = new TextEncoder();

/**
 * RFC 5545 §3.1 folding: content lines longer than 75 octets are split with CRLF + one
 * space. Splits only between code points so multi-byte UTF-8 characters stay intact.
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const octets = encoder.encode(char).length;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
      // Continuation lines start with a space, which counts toward the 75 octets.
      limit = MAX_LINE_OCTETS - 1;
    }
    current += char;
    currentOctets += octets;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Builds a single-event VCALENDAR with a DISPLAY alarm; CRLF line endings throughout. */
export function buildIcsCalendar(event: CalendarEvent, now: Date): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Salon SaaS//Randevu//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatCalendarUtc(now)}`,
    `DTSTART:${formatCalendarUtc(event.startAt)}`,
    `DTEND:${formatCalendarUtc(event.endAt)}`,
    "SEQUENCE:0",
    `STATUS:${event.status}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `URL:${event.url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(event.title)}`,
    `TRIGGER:-PT${CALENDAR_ALARM_MINUTES_BEFORE}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Google Calendar "create event" template link with every parameter percent-encoded. */
export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const params: Array<[string, string]> = [
    ["action", "TEMPLATE"],
    ["text", event.title],
    ["dates", `${formatCalendarUtc(event.startAt)}/${formatCalendarUtc(event.endAt)}`],
    ["details", event.description],
  ];
  if (event.location) params.push(["location", event.location]);
  const query = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return `https://calendar.google.com/calendar/render?${query}`;
}

/** Only open (PENDING/CONFIRMED) appointments that have not started yet get calendar links. */
export function isCalendarEligible(status: string, startAt: Date, now: Date): boolean {
  return (status === "PENDING" || status === "CONFIRMED") && startAt.getTime() > now.getTime();
}

export type AppointmentCalendarInput = Readonly<{
  calendarUid: string;
  serviceName: string;
  salonName: string;
  staffName: string;
  salonAddress: string | null;
  startAtIso: string;
  endAtIso: string;
  status: "PENDING" | "CONFIRMED";
  statusUrl: string;
}>;

/** Maps the customer-visible appointment fields to a calendar event (no other personal data). */
export function appointmentCalendarEvent(input: AppointmentCalendarInput): CalendarEvent {
  const address = input.salonAddress?.trim();
  return {
    uid: input.calendarUid,
    title: `${input.serviceName} — ${input.salonName}`,
    startAt: new Date(input.startAtIso),
    endAt: new Date(input.endAtIso),
    location: address ? address : null,
    description: [
      `Personel: ${input.staffName}`,
      input.statusUrl,
      "Randevunuzu bu bağlantıdan yönetebilirsiniz.",
    ].join("\n"),
    url: input.statusUrl,
    status: input.status === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE",
  };
}
