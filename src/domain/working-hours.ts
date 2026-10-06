export type WorkingHoursRecord = Readonly<{
  id: string;
  tenantId: string;
  dayOfWeek: number;
  openMinute: number;
  closeMinute: number;
}>;

export const MINUTES_PER_DAY = 24 * 60;

export function createWorkingHoursDay(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 6) {
    throw new TypeError("Working hours day is invalid");
  }
  return value;
}

function createMinute(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= MINUTES_PER_DAY) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

export function createWorkingHoursOpenMinute(value: unknown): number {
  return createMinute(value, "Working hours open minute");
}

export function createWorkingHoursCloseMinute(value: unknown): number {
  return createMinute(value, "Working hours close minute");
}

export function createWorkingHoursRecord(input: {
  id: string;
  tenantId: string;
  dayOfWeek: unknown;
  openMinute: unknown;
  closeMinute: unknown;
}): WorkingHoursRecord {
  if (typeof input.id !== "string" || input.id.length === 0) throw new TypeError("Working hours id is invalid");
  if (typeof input.tenantId !== "string" || input.tenantId.length === 0) throw new TypeError("Working hours tenant is invalid");
  const dayOfWeek = createWorkingHoursDay(input.dayOfWeek);
  const openMinute = createWorkingHoursOpenMinute(input.openMinute);
  const closeMinute = createWorkingHoursCloseMinute(input.closeMinute);
  if (closeMinute <= openMinute) throw new TypeError("Working hours close must be after open");
  return Object.freeze({ id: input.id, tenantId: input.tenantId, dayOfWeek, openMinute, closeMinute });
}

export function isMinuteRangeWithinWorkingHours(
  openMinute: number,
  closeMinute: number,
  startMinute: number,
  endMinute: number,
): boolean {
  return startMinute >= openMinute && endMinute <= closeMinute && endMinute > startMinute;
}
