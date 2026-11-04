import type { AppointmentRecord } from "./appointment";
import type { WorkingHoursRecord } from "./working-hours";

export const DEFAULT_SLOT_INTERVAL_MINUTES = 15;

export type AvailabilitySlot = Readonly<{ startAt: Date; endAt: Date }>;

function partsInTimeZone(date: Date, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date)
    .filter((p) => p.type !== "literal")
    .map((p) => [p.type, Number(p.value)]));
}

function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function utcToLocalDateAndMinute(date: Date, timeZone: string): { dateIso: string; minute: number } {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError("Date is invalid");
  const p = partsInTimeZone(date, timeZone);
  return { dateIso: `${p.year.toString().padStart(4,"0")}-${p.month.toString().padStart(2,"0")}-${p.day.toString().padStart(2,"0")}`, minute: p.hour * 60 + p.minute };
}

function parseAndValidateDateIso(dateIso: string): { year: number; month: number; day: number } {
  if (typeof dateIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new TypeError("Date is invalid");
  }
  const [year, month, day] = dateIso.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new TypeError("Date is invalid");
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (year >= 0 && year < 100) {
    parsed.setUTCFullYear(year);
  }
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new TypeError("Date is invalid");
  }
  return { year, month, day };
}

export function localWallTimeToUtc(dateIso: string, minute: number, timeZone: string): Date {
  const { year, month, day } = parseAndValidateDateIso(dateIso);
  if (!Number.isInteger(minute) || minute < 0 || minute >= 1440) throw new TypeError("Minute is invalid");
  assertValidTimeZone(timeZone);
  const candidates = localWallTimeCandidates(year, month, day, minute, timeZone);
  if (candidates.length === 0) {
    throw new RangeError("Local time does not exist in this timezone");
  }
  if (candidates.length > 1) {
    throw new RangeError("Local time is ambiguous in this timezone");
  }
  return candidates[0];
}

function localWallTimeCandidates(year: number, month: number, day: number, minute: number, timeZone: string): Date[] {
  const wallUtc = Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60);
  // Sample offsets around the requested wall time instead of assuming a fixed offset.
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(offsetMinutes(new Date(wallUtc + hours * 60 * 60_000), timeZone));
  }

  const candidates = [...offsets]
    .map((offset) => new Date(wallUtc - offset * 60_000))
    .filter((candidate) => {
      const local = partsInTimeZone(candidate, timeZone);
      return local.year === year &&
        local.month === month &&
        local.day === day &&
        local.hour === Math.floor(minute / 60) &&
        local.minute === minute % 60;
    });
  return candidates.sort((a, b) => a.getTime() - b.getTime());
}

/** Calendar date arithmetic on "YYYY-MM-DD", independent of any timezone. */
export function addDaysToDateIso(dateIso: string, days: number): string {
  const { year, month, day } = parseAndValidateDateIso(dateIso);
  if (!Number.isInteger(days)) throw new TypeError("Days is invalid");
  const next = new Date(Date.UTC(year, month - 1, day));
  if (year >= 0 && year < 100) next.setUTCFullYear(year);
  next.setUTCDate(next.getUTCDate() + days);
  return `${next.getUTCFullYear().toString().padStart(4, "0")}-${(next.getUTCMonth() + 1).toString().padStart(2, "0")}-${next.getUTCDate().toString().padStart(2, "0")}`;
}

/** First UTC instant whose local date in `timeZone` is `dateIso`. Never throws for a midnight DST gap. */
function localDayStartUtc(dateIso: string, timeZone: string): Date {
  const { year, month, day } = parseAndValidateDateIso(dateIso);
  for (let minute = 0; minute < 1440; minute += 1) {
    const candidates = localWallTimeCandidates(year, month, day, minute, timeZone);
    if (candidates.length > 0) return candidates[0];
  }
  throw new RangeError("Local date does not exist in this timezone");
}

/**
 * WP-08: the UTC half-open range [startAt, endAt) covering one local calendar day.
 * DST-safe (23/25-hour days) and tolerant of zones whose midnight does not exist
 * (the day then starts at the first existing local minute).
 */
export function localDayUtcRange(dateIso: string, timeZone: string): Readonly<{ startAt: Date; endAt: Date }> {
  assertValidTimeZone(timeZone);
  return Object.freeze({
    startAt: localDayStartUtc(dateIso, timeZone),
    endAt: localDayStartUtc(addDaysToDateIso(dateIso, 1), timeZone),
  });
}

/**
 * WP-08: a slot touches a closed date when the local date of its start, or of its
 * last occupied instant (endAt incl. buffer minus 1 ms), is closed. Pure local-date
 * comparison, so it is DST-safe.
 */
export function isSlotOnClosedDate(
  slot: Readonly<{ startAt: Date; endAt: Date }>,
  timeZone: string,
  closedDates: ReadonlySet<string> | ReadonlyArray<string>,
): boolean {
  const closed = closedDates instanceof Set ? closedDates : new Set(closedDates as ReadonlyArray<string>);
  if (closed.size === 0) return false;
  const startDate = utcToLocalDateAndMinute(slot.startAt, timeZone).dateIso;
  if (closed.has(startDate)) return true;
  const lastInstant = new Date(Math.max(slot.startAt.getTime(), slot.endAt.getTime() - 1));
  return closed.has(utcToLocalDateAndMinute(lastInstant, timeZone).dateIso);
}

export function dateDayOfWeek(dateIso: string): number {
  const { year, month, day } = parseAndValidateDateIso(dateIso);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (year >= 0 && year < 100) {
    parsed.setUTCFullYear(year);
  }
  return parsed.getUTCDay();
}

function assertValidTimeZone(timeZone: string): void {
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    throw new TypeError("Timezone is invalid");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new TypeError("Timezone is invalid");
  }
}

export function calculateAvailability(input: {
  dateIso: string;
  timeZone: string;
  workingHours: ReadonlyArray<WorkingHoursRecord>;
  staffId: string;
  appointments: ReadonlyArray<AppointmentRecord>;
  durationMinutes: number;
  bufferMinutes: number;
  now?: Date;
  slotIntervalMinutes?: number;
  /** WP-08: closed local dates ("YYYY-MM-DD") in the tenant timezone. */
  closedDates?: ReadonlySet<string> | ReadonlyArray<string>;
}): ReadonlyArray<AvailabilitySlot> {
  assertValidTimeZone(input.timeZone);
  const day = dateDayOfWeek(input.dateIso);
  const closedDates: ReadonlySet<string> = input.closedDates instanceof Set
    ? input.closedDates
    : new Set((input.closedDates ?? []) as ReadonlyArray<string>);
  if (closedDates.has(input.dateIso)) return [];
  const hours = input.workingHours.find((h) => h.dayOfWeek === day);
  if (!hours) return [];
  const interval = input.slotIntervalMinutes ?? DEFAULT_SLOT_INTERVAL_MINUTES;
  if (!Number.isInteger(interval) || interval < 1) throw new TypeError("Slot interval is invalid");
  const requiredMinutes = input.durationMinutes + input.bufferMinutes;
  const slots: AvailabilitySlot[] = [];
  for (let minute = hours.openMinute; minute + requiredMinutes <= hours.closeMinute; minute += interval) {
    let startAt: Date;
    try {
      startAt = localWallTimeToUtc(input.dateIso, minute, input.timeZone);
    } catch (error) {
      if (error instanceof RangeError && (
        error.message === "Local time does not exist in this timezone" ||
        error.message === "Local time is ambiguous in this timezone"
      )) continue;
      throw error;
    }
    const endAt = new Date(startAt.getTime() + requiredMinutes * 60_000);
    if (input.now && startAt <= input.now) continue;
    if (isSlotOnClosedDate({ startAt, endAt }, input.timeZone, closedDates)) continue;
    const conflicts = input.appointments.some((a) =>
      a.staffId === input.staffId &&
      a.status !== "CANCELLED" && a.status !== "REJECTED" &&
      startAt < a.endAt && endAt > a.startAt,
    );
    if (!conflicts) slots.push(Object.freeze({ startAt, endAt }));
  }
  return slots;
}
