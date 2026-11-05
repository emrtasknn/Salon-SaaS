// Pure layout math for the day timeline ("Zaman çizelgesi").
// Presentation only: never decides availability, status transitions or authorization.

/** Tenant wall-clock zone used by the calendars (loaders resolve the day in the tenant timezone). */
export const TIMELINE_TIME_ZONE = "Europe/Istanbul";

export type MinuteRange = Readonly<{ startMin: number; endMin: number }>;

/** Shown when nothing in the data says otherwise: 08:00–21:00. */
export const DEFAULT_TIMELINE_RANGE: MinuteRange = { startMin: 8 * 60, endMin: 21 * 60 };

const DAY_MINUTES = 24 * 60;
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(instant: Date, timeZone: string) {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  const hour = Number(parts.hour) % 24;
  return {
    dateIso: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

function isoToUtcDays(dateIso: string) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Wall-clock minutes of `instant` relative to 00:00 of `dateIso` in `timeZone` (may be <0 or >1440). */
export function minutesFromDayStart(instant: Date | string | number, dateIso: string, timeZone = TIMELINE_TIME_ZONE) {
  const parts = zonedParts(new Date(instant), timeZone);
  return (isoToUtcDays(parts.dateIso) - isoToUtcDays(dateIso)) * DAY_MINUTES + parts.minutes;
}

/** Today's date (YYYY-MM-DD) in `timeZone`. */
export function todayInZone(timeZone = TIMELINE_TIME_ZONE, now: Date = new Date()) {
  return zonedParts(now, timeZone).dateIso;
}

/** Calendar-date arithmetic on a YYYY-MM-DD string (no timezone involved). */
export function addDays(dateIso: string, days: number) {
  const date = new Date((isoToUtcDays(dateIso) + days) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/**
 * Visible range: whole hours covering the base range and every interval, clamped to the day.
 */
export function computeRange(intervals: ReadonlyArray<MinuteRange>, base: MinuteRange = DEFAULT_TIMELINE_RANGE): MinuteRange {
  let start = base.startMin;
  let end = base.endMin;
  for (const interval of intervals) {
    start = Math.min(start, interval.startMin);
    end = Math.max(end, interval.endMin);
  }
  start = Math.max(0, Math.floor(start / 60) * 60);
  end = Math.min(DAY_MINUTES, Math.ceil(end / 60) * 60);
  if (end <= start) end = Math.min(DAY_MINUTES, start + 60);
  return { startMin: start, endMin: end };
}

/** Horizontal placement in percent of the range; intervals are clipped to the range. */
export function placeInterval(interval: MinuteRange, range: MinuteRange) {
  const span = range.endMin - range.startMin;
  const start = Math.min(Math.max(interval.startMin, range.startMin), range.endMin);
  const end = Math.min(Math.max(interval.endMin, start), range.endMin);
  return {
    leftPct: ((start - range.startMin) / span) * 100,
    widthPct: ((end - start) / span) * 100,
  };
}

/** Percent position of a single minute, or null when outside the range. */
export function minuteToPct(minute: number, range: MinuteRange) {
  if (minute < range.startMin || minute > range.endMin) return null;
  return ((minute - range.startMin) / (range.endMin - range.startMin)) * 100;
}

export type Tick = Readonly<{ minute: number; kind: "hour" | "half" }>;

/** Hour gridlines plus half-hour ticks, from range start to range end inclusive. */
export function ticks(range: MinuteRange): Tick[] {
  const result: Tick[] = [];
  for (let minute = range.startMin; minute <= range.endMin; minute += 30) {
    result.push({ minute, kind: minute % 60 === 0 ? "hour" : "half" });
  }
  return result;
}

export function formatMinute(minute: number) {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

type LaneInput = Readonly<{ id: string; startMin: number; endMin: number }>;

/**
 * Greedy interval partitioning: overlapping items get separate lanes; touching items
 * (end === next start) share a lane. Deterministic for equal starts (shorter first, then id).
 */
export function assignLanes(items: ReadonlyArray<LaneInput>) {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id),
  );
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    lanes.set(item.id, lane);
  }
  return { lanes, laneCount: Math.max(1, laneEnds.length) };
}

/**
 * Minute to bring into view first: the current hour when it is visible, else the first
 * appointment's hour, else the range start.
 */
export function initialScrollMinute(range: MinuteRange, firstStartMin: number | null, nowMin: number | null) {
  const clamp = (m: number) => Math.min(Math.max(m, range.startMin), range.endMin);
  if (nowMin !== null && nowMin >= range.startMin && nowMin <= range.endMin) return clamp(Math.floor(nowMin / 60) * 60);
  if (firstStartMin !== null) return clamp(Math.floor(firstStartMin / 60) * 60);
  return range.startMin;
}

/* ------------------------------------------------------------------------------------------ */
/* Calendar ranges (Gün | Hafta | Ay) and the loader's range validation.                       */
/* ------------------------------------------------------------------------------------------ */

/** Longest inclusive range a calendar loader accepts: a 6-week month grid. */
export const CALENDAR_RANGE_MAX_DAYS = 42;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Validates a loader range (local YYYY-MM-DD, inclusive). `endDate` defaults to `startDate`.
 * Both must be real calendar dates, start <= end, and the span at most CALENDAR_RANGE_MAX_DAYS days.
 */
export function parseCalendarRange(startDate: unknown, endDate?: unknown): { startDate: string; endDate: string } | null {
  const end = endDate === undefined || endDate === null ? startDate : endDate;
  if (!isRealIsoDate(startDate) || !isRealIsoDate(end)) return null;
  const days = isoToUtcDays(end) - isoToUtcDays(startDate) + 1;
  if (days < 1 || days > CALENDAR_RANGE_MAX_DAYS) return null;
  return { startDate, endDate: end };
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(dateIso: string) {
  return (new Date(`${dateIso}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** Monday of the week that contains `dateIso`. */
export function startOfWeek(dateIso: string) {
  return addDays(dateIso, -weekdayIndex(dateIso));
}

/** The seven dates (Mon–Sun) of the week containing `dateIso`. */
export function weekDates(dateIso: string) {
  const monday = startOfWeek(dateIso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Same day-of-month `months` later, clamped to the target month's length. */
export function addMonths(dateIso: string, months: number) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

/**
 * Month grid: whole Mon–Sun weeks covering the month of `dateIso` (4–6 weeks, at most 42 days).
 * `month` is the YYYY-MM prefix used to mute days outside the month.
 */
export function monthGrid(dateIso: string) {
  const month = dateIso.slice(0, 7);
  const first = `${month}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const start = startOfWeek(first);
  const end = addDays(startOfWeek(last), 6);
  const weeks: string[][] = [];
  for (let day = start; day <= end; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return { month, startDate: start, endDate: end, weeks };
}

export type CalendarViewKind = "day" | "week" | "month" | "list";

/** Inclusive date range the loader needs for a view anchored on `dateIso`. */
export function viewDateRange(view: CalendarViewKind, dateIso: string) {
  if (view === "week") {
    const days = weekDates(dateIso);
    return { startDate: days[0], endDate: days[6] };
  }
  if (view === "month") {
    const grid = monthGrid(dateIso);
    return { startDate: grid.startDate, endDate: grid.endDate };
  }
  return { startDate: dateIso, endDate: dateIso };
}

/** Anchor date after one ‹ / › step in the given view. */
export function stepDate(view: CalendarViewKind, dateIso: string, direction: 1 | -1) {
  if (view === "week") return addDays(dateIso, 7 * direction);
  if (view === "month") return addMonths(dateIso, direction);
  return addDays(dateIso, direction);
}

/** Local date (YYYY-MM-DD in `timeZone`) of an instant. */
export function dateInZone(instant: Date | string | number, timeZone = TIMELINE_TIME_ZONE) {
  return zonedParts(new Date(instant), timeZone).dateIso;
}

/* ------------------------------------------------------------------------------------------ */
/* Vertical time grid: placement and side-by-side lanes per column.                            */
/* ------------------------------------------------------------------------------------------ */

/** Top offset and height in px for a vertical axis where one hour is `hourPx` tall. */
export function placeVertical(interval: MinuteRange, range: MinuteRange, hourPx: number, minHeightPx = 0) {
  const start = Math.min(Math.max(interval.startMin, range.startMin), range.endMin);
  const end = Math.min(Math.max(interval.endMin, start), range.endMin);
  const top = ((start - range.startMin) / 60) * hourPx;
  const maxHeight = ((range.endMin - start) / 60) * hourPx;
  const height = Math.min(Math.max(((end - start) / 60) * hourPx, minHeightPx), Math.max(maxHeight, minHeightPx));
  return { top, height };
}

/**
 * Side-by-side lanes inside one column. Items that overlap (directly or through a chain) form a
 * cluster; each item gets a lane and the cluster's lane count, so non-overlapping items keep the
 * full column width. `minDurationMin` stretches very short items to their minimum drawn height
 * so a bar that is drawn taller than its duration never covers the next one.
 */
export function layoutColumn(items: ReadonlyArray<LaneInput>, minDurationMin = 0) {
  const sorted = [...items]
    .map((item) => ({ ...item, endMin: Math.max(item.endMin, item.startMin + minDurationMin) }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id));
  const result = new Map<string, { lane: number; laneCount: number }>();
  let cluster: Array<{ id: string; lane: number }> = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const member of cluster) result.set(member.id, { lane: member.lane, laneCount: Math.max(1, laneEnds.length) });
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    cluster.push({ id: item.id, lane });
    clusterEnd = cluster.length === 1 ? item.endMin : Math.max(clusterEnd, item.endMin);
  }
  flush();
  return result;
}
