// Pure helpers between "minutes after midnight" (server contract for working hours)
// and the "HH:MM" value of <input type="time">. Presentation only.

const MINUTES_PER_DAY = 24 * 60;

/** 540 → "09:00". Returns "" for values outside 0–1439 or non-integers. */
export function minutesToTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** "18:00" → 1080. Accepts "HH:MM" (and a trailing ":SS" some browsers send); null when invalid. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 540, 1080 → "09:00–18:00"; "" when either side is invalid. */
export function formatHoursRange(openMinute: number, closeMinute: number): string {
  const open = minutesToTime(openMinute);
  const close = minutesToTime(closeMinute);
  return open && close ? `${open}–${close}` : "";
}
