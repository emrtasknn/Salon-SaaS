import { dateInZone } from "../_ui/timeline-layout";

// Staff home ("Özet") figures from the staff member's own appointments, already loaded and
// authorized by listStaffAppointments. Pure and presentation only.

export type SummaryAppointment = Readonly<{
  id: string;
  startAt: Date | string;
  endAt: Date | string;
  status: string;
}>;

const ms = (value: Date | string) => new Date(value).getTime();

const LIVE = new Set(["PENDING", "CONFIRMED"]);

export type StaffHomeSummary<T extends SummaryAppointment> = Readonly<{
  /** Live appointments today (pending or confirmed), in time order. */
  today: T[];
  /** Today's live appointments that have not ended yet. */
  todayRemaining: number;
  /** Requests waiting for a decision in the loaded range, soonest first. */
  pending: T[];
  /** Live appointments in the loaded range (today + the next six days). */
  weekCount: number;
  /** The live appointment running now, or the next one to start. */
  next: T | null;
  /** Minutes until `next` starts; 0 while it is running. */
  nextStartsInMinutes: number | null;
}>;

const byStart = (a: SummaryAppointment, b: SummaryAppointment) => ms(a.startAt) - ms(b.startAt);

export function staffHomeSummary<T extends SummaryAppointment>(items: readonly T[], nowMs: number, todayIso: string): StaffHomeSummary<T> {
  const live = items.filter((item) => LIVE.has(item.status)).sort(byStart);
  const today = live.filter((item) => dateInZone(item.startAt) === todayIso);
  const upcoming = live.filter((item) => ms(item.endAt) > nowMs);
  const next = upcoming[0] ?? null;
  const nextStartsInMinutes = next ? Math.max(0, Math.ceil((ms(next.startAt) - nowMs) / 60_000)) : null;
  return {
    today,
    todayRemaining: today.filter((item) => ms(item.endAt) > nowMs).length,
    pending: live.filter((item) => item.status === "PENDING" && ms(item.endAt) > nowMs),
    weekCount: live.length,
    next,
    nextStartsInMinutes,
  };
}

/** "Şimdi", "25 dk sonra", "2 sa 5 dk sonra", "Yarın", "3 gün sonra" (by calendar day). */
export function startsInLabel(minutes: number, startAt: Date | string, todayIso: string): string {
  if (minutes <= 0) return "Şimdi";
  const startDay = dateInZone(startAt);
  if (startDay !== todayIso) {
    const days = Math.round((Date.parse(`${startDay}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000);
    return days === 1 ? "Yarın" : `${days} gün sonra`;
  }
  if (minutes < 60) return `${minutes} dk sonra`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} sa sonra` : `${hours} sa ${rest} dk sonra`;
}
