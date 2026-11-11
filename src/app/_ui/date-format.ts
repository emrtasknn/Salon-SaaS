import { TIMELINE_TIME_ZONE } from "./timeline-layout";

type Instant = Date | string | number;

function parts(instant: Instant, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("tr-TR", { timeZone, ...options }).formatToParts(new Date(instant))) {
    out[part.type] = part.value;
  }
  return out;
}

/**
 * "7 Kas Cmt 11:00" in the salon's time zone. Server components run in UTC on
 * Vercel, so a bare toLocaleString() would show times 3 hours early.
 */
export function formatAppointmentDateTime(instant: Instant, timeZone: string = TIMELINE_TIME_ZONE): string {
  const p = parts(instant, timeZone, {
    day: "numeric",
    month: "short",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${p.day} ${p.month} ${p.weekday} ${p.hour}:${p.minute}`;
}

/** "07.11.2026" in the salon's time zone. */
export function formatDateInZone(instant: Instant, timeZone: string = TIMELINE_TIME_ZONE): string {
  const p = parts(instant, timeZone, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${p.day}.${p.month}.${p.year}`;
}

/** "7 Kas Cmt" in the salon's time zone (sheet titles, list headers). */
export function formatDayLabel(instant: Instant, timeZone: string = TIMELINE_TIME_ZONE): string {
  const p = parts(instant, timeZone, { day: "numeric", month: "short", weekday: "short" });
  return `${p.day} ${p.month} ${p.weekday}`;
}

/**
 * Header label for a calendar date (YYYY-MM-DD wall date): "Bugün · 6 Kas Cum"
 * or "7 Kas Cmt". Wall dates are formatted in UTC so they never shift.
 */
export function formatIsoDayLabel(dateIso: string, todayIso: string): string {
  const label = formatDayLabel(`${dateIso}T12:00:00.000Z`, "UTC");
  return dateIso === todayIso ? `Bugün · ${label}` : label;
}

/** "10 Kas 2026" for a calendar date (YYYY-MM-DD wall date); formatted in UTC so it never shifts. */
export function formatDateFieldLabel(dateIso: string): string {
  const p = parts(`${dateIso}T12:00:00.000Z`, "UTC", { day: "numeric", month: "short", year: "numeric" });
  return `${p.day} ${p.month} ${p.year}`;
}

/** "6 Kas" in the salon's time zone; the year is added only when it differs from `now`'s year. */
export function formatShortDate(instant: Instant, now: Date, timeZone: string = TIMELINE_TIME_ZONE): string {
  const p = parts(instant, timeZone, { day: "numeric", month: "short", year: "numeric" });
  const currentYear = parts(now, timeZone, { year: "numeric" }).year;
  return p.year === currentYear ? `${p.day} ${p.month}` : `${p.day} ${p.month} ${p.year}`;
}
