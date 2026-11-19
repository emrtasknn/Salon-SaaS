export const dynamic = "force-dynamic";

import { listStaffAppointments, listStaffNotifications } from "../actions";
import { StaffCalendar } from "../calendar";
import { InAppNotifications } from "../../in-app-notifications";
import { parseCalendarDeepLink } from "../../_ui/deep-link";
import { todayInZone, weekDates } from "../../_ui/timeline-layout";

export default async function StaffCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Tenants are locked to Europe/Istanbul (MVP); UTC would show yesterday between 00:00 and 03:00.
  const { date, appointmentId } = parseCalendarDeepLink(await searchParams, todayInZone());
  // The week around the anchor date: covers the day, list and week views without a second load.
  const week = weekDates(date);
  const range = { startDate: week[0], endDate: week[6] };
  const [data, notifications] = await Promise.all([
    listStaffAppointments(range.startDate, range.endDate),
    listStaffNotifications(),
  ]);
  return (
    <StaffCalendar
      key={`${date}:${appointmentId ?? ""}`}
      initialDate={date}
      initialRange={range}
      initialData={data}
      initialSelectedId={appointmentId}
      bell={<InAppNotifications initialData={notifications} reload={listStaffNotifications} href="/staff/calendar" />}
    />
  );
}
