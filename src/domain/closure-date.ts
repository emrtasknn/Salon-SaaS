import { utcToLocalDateAndMinute } from "./availability";

// WP-08: closed dates are LOCAL calendar dates ("YYYY-MM-DD") in the tenant timezone.
// Persisted as PostgreSQL DATE; Prisma maps @db.Date to a Date at 00:00:00.000Z.

export const CLOSURE_REASON_MAX_LENGTH = 200;
/** Upper bound for a single list query, in days (inclusive range). */
export const CLOSURE_LIST_MAX_DAYS = 366;

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

export type ClosureRecord = Readonly<{ id: string; date: string; reason: string | null }>;

/** Returns the date when it is a real calendar date "YYYY-MM-DD" (year 1970-9999), else null. */
export function parseClosureDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_ISO.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
  return value;
}

/**
 * Optional reason: trimmed; blank/missing -> null (matches the DB CHECK "reason IS NULL OR
 * reason ~ '[^[:space:]]'"; JS trim() removes tabs/newlines too, so whitespace-only input becomes null); longer than 200 characters or containing control characters -> invalid.
 */
export function normalizeClosureReason(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > CLOSURE_REASON_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

/** Tenant-local "today" as "YYYY-MM-DD". */
export function tenantLocalToday(now: Date, timeZone: string): string {
  return utcToLocalDateAndMinute(now, timeZone).dateIso;
}

/** True when `dateIso` is strictly before the tenant-local today (today itself may still be closed). */
export function isPastLocalDate(dateIso: string, now: Date, timeZone: string): boolean {
  return dateIso < tenantLocalToday(now, timeZone);
}

/** "YYYY-MM-DD" -> Date at UTC midnight, the Prisma representation of a DATE column. */
export function closureDateToDb(dateIso: string): Date {
  if (parseClosureDate(dateIso) === null) throw new TypeError("Closure date is invalid");
  return new Date(`${dateIso}T00:00:00.000Z`);
}

/** Prisma DATE value -> "YYYY-MM-DD". */
export function closureDateFromDb(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError("Closure date is invalid");
  return value.toISOString().slice(0, 10);
}

/**
 * Query window for the admin "upcoming closures" list (local YYYY-MM-DD).
 * Starts one day before UTC today so tenant-local today is covered in any
 * timezone; the span is exactly CLOSURE_LIST_MAX_DAYS so parseClosureRange
 * accepts it. Pure calendar arithmetic, no timezone shift.
 */
export function upcomingClosureRange(now: Date = new Date()): { from: string; to: string } {
  const day = 86_400_000;
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: new Date(base - day).toISOString().slice(0, 10),
    to: new Date(base + (CLOSURE_LIST_MAX_DAYS - 1) * day).toISOString().slice(0, 10),
  };
}

/** Validates an inclusive list range; both ends must be real dates, from <= to, span <= 366 days. */
export function parseClosureRange(from: unknown, to: unknown): { from: string; to: string } | null {
  const start = parseClosureDate(from);
  const end = parseClosureDate(to);
  if (!start || !end || start > end) return null;
  const days = (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000;
  if (days > CLOSURE_LIST_MAX_DAYS) return null;
  return { from: start, to: end };
}
