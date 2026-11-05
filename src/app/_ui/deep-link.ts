import { dateInZone, isRealIsoDate, todayInZone } from "./timeline-layout";

// Calendar deep links (notification → appointment). UI selection only: the calendar loads data
// through the usual tenant/role-checked server reads and only opens an id it already received.

const APPOINTMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Reads `?date=YYYY-MM-DD&appointment=<id>`; anything malformed falls back to today / none. */
export function parseCalendarDeepLink(params: SearchParams | undefined, today: string = todayInZone()) {
  const date = first(params?.date);
  const appointment = first(params?.appointment);
  return {
    date: isRealIsoDate(date) ? date : today,
    appointmentId: appointment && APPOINTMENT_ID.test(appointment) ? appointment : null,
  };
}

/** Link from a notification item to its day in the calendar with the appointment opened. */
export function appointmentHref(base: string, item: { appointmentId: string; startAt: string }) {
  const query = new URLSearchParams({ date: dateInZone(item.startAt), appointment: item.appointmentId });
  return `${base}?${query.toString()}`;
}
