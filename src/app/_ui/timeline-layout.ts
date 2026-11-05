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
