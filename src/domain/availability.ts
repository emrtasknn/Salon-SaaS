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

export function localWallTimeToUtc(dateIso: string, minute: number, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) throw new TypeError("Date is invalid");
  if (!Number.isInteger(minute) || minute < 0 || minute >= 1440) throw new TypeError("Minute is invalid");
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); } catch { throw new TypeError("Timezone is invalid"); }
  const [year, month, day] = dateIso.split("-").map(Number);
  const wallUtc = Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60);
  let utc = wallUtc - offsetMinutes(new Date(wallUtc), timeZone) * 60000;
  const correctedOffset = offsetMinutes(new Date(utc), timeZone);
  utc = wallUtc - correctedOffset * 60000;
  return new Date(utc);
}

export function dateDayOfWeek(dateIso: string): number {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
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
}): ReadonlyArray<AvailabilitySlot> {
  const day = dateDayOfWeek(input.dateIso);
  const hours = input.workingHours.find((h) => h.dayOfWeek === day);
  if (!hours) return [];
  const interval = input.slotIntervalMinutes ?? DEFAULT_SLOT_INTERVAL_MINUTES;
  if (!Number.isInteger(interval) || interval < 1) throw new TypeError("Slot interval is invalid");
  const requiredMinutes = input.durationMinutes + input.bufferMinutes;
  const slots: AvailabilitySlot[] = [];
  for (let minute = hours.openMinute; minute + requiredMinutes <= hours.closeMinute; minute += interval) {
    const startAt = localWallTimeToUtc(input.dateIso, minute, input.timeZone);
    const endAt = new Date(startAt.getTime() + requiredMinutes * 60_000);
    if (input.now && startAt <= input.now) continue;
    const conflicts = input.appointments.some((a) =>
      a.staffId === input.staffId &&
      a.status !== "CANCELLED" && a.status !== "REJECTED" &&
      startAt < a.endAt && endAt > a.startAt,
    );
    if (!conflicts) slots.push(Object.freeze({ startAt, endAt }));
  }
  return slots;
}
