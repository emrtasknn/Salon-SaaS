import { dateInZone } from "./timeline-layout";

/** Statuses that no longer occupy the calendar. */
const ENDED = new Set(["CANCELLED", "REJECTED"]);

/** Local dates that have at least one live (not cancelled/rejected) appointment. */
export function liveAppointmentDates(items: ReadonlyArray<{ startAt: Date | string; status: string }>): ReadonlySet<string> {
  const dates = new Set<string>();
  for (const item of items) if (!ENDED.has(item.status)) dates.add(dateInZone(item.startAt));
  return dates;
}
