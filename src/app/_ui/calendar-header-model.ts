// Pure helpers for the compact calendar header (labels, week strip, swipe, load range).
// Presentation only: none of this decides what data a user may read.

import { addDays, viewDateRange, weekDates, type CalendarViewKind } from "./timeline-layout";

function formatIsoDate(dateIso: string, options: Intl.DateTimeFormatOptions) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", ...options }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** One short line for the header: "19 Kasım Perşembe", "17–23 Kasım", "Kasım 2026". */
export function compactPeriodLabel(view: CalendarViewKind, dateIso: string, todayIso: string): string {
  if (view === "month") return formatIsoDate(dateIso, { month: "long", year: "numeric" });
  if (view === "week") {
    const days = weekDates(dateIso);
    const first = days[0];
    const last = days[6];
    const sameMonth = first.slice(0, 7) === last.slice(0, 7);
    const start = formatIsoDate(first, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
    const end = formatIsoDate(last, sameMonth ? { day: "numeric", month: "long" } : { day: "numeric", month: "short" });
    return `${start}–${end}`;
  }
  const yearSuffix = dateIso.slice(0, 4) === todayIso.slice(0, 4) ? {} : { year: "numeric" as const };
  return formatIsoDate(dateIso, { day: "numeric", month: "long", weekday: "long", ...yearSuffix });
}

/**
 * Range to load for a view. Day and list load their whole week so the week strip can mark busy
 * days and moving between days of the same week needs no new request; they still show one day.
 */
export function loadDateRange(view: CalendarViewKind, dateIso: string) {
  if (view === "day" || view === "list") return viewDateRange("week", dateIso);
  return viewDateRange(view, dateIso);
}

export type WeekStripDay = Readonly<{
  date: string;
  weekday: string;
  dayOfMonth: string;
  selected: boolean;
  today: boolean;
  marked: boolean;
}>;

/** The Mon–Sun week around `dateIso`, with selection, today and busy marks. */
export function weekStripDays(dateIso: string, todayIso: string, marked: ReadonlySet<string>): WeekStripDay[] {
  return weekDates(dateIso).map((date) => ({
    date,
    weekday: formatIsoDate(date, { weekday: "short" }),
    dayOfMonth: String(Number(date.slice(8, 10))),
    selected: date === dateIso,
    today: date === todayIso,
    marked: marked.has(date),
  }));
}

/** Minimum horizontal travel (px) for a swipe, and how much more horizontal than vertical it must be. */
export const SWIPE_MIN_PX = 48;

/** +1 = swipe left (go forward), -1 = swipe right (go back), 0 = not a horizontal swipe. */
export function swipeDirection(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/** Same weekday one week earlier or later (week strip swipe). */
export function shiftWeek(dateIso: string, direction: 1 | -1) {
  return addDays(dateIso, 7 * direction);
}

/** Whether "Bugün" would change anything for this view. */
export function showsToday(view: CalendarViewKind, dateIso: string, todayIso: string) {
  if (view === "day" || view === "list") return dateIso === todayIso;
  const range = viewDateRange(view, dateIso);
  if (view === "month") return dateIso.slice(0, 7) === todayIso.slice(0, 7);
  return todayIso >= range.startDate && todayIso <= range.endDate;
}
