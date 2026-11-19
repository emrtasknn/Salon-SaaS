export const dynamic = "force-dynamic";

import { listAdminAppointments, listAdminNotifications } from "../calendar-actions";
import { listClosures } from "../closure-actions";
import { AdminCalendar } from "../calendar";
import { InAppNotifications } from "../../in-app-notifications";
import { upcomingClosureRange } from "../../../domain/closure-date";
import { parseCalendarDeepLink } from "../../_ui/deep-link";
import { weekDates } from "../../_ui/timeline-layout";
import type { ClosureListResult } from "../../appointment-create-contract";

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { date, appointmentId } = parseCalendarDeepLink(await searchParams);
  const closureRange = upcomingClosureRange();
  // The week around the anchor date: covers the day, list and week views without a second load.
  const week = weekDates(date);
  const range = { startDate: week[0], endDate: week[6] };
  const [data, notifications, closures] = await Promise.all([
    listAdminAppointments(range.startDate, range.endDate),
    listAdminNotifications(),
    listClosures(closureRange).catch((): ClosureListResult => ({ status: "INVALID_INPUT" })),
  ]);
  return (
    <AdminCalendar
      key={`${date}:${appointmentId ?? ""}`}
      initialDate={date}
      initialRange={range}
      initialData={data}
      initialSelectedId={appointmentId}
      closures={{ initialData: closures, range: closureRange }}
      bell={<InAppNotifications initialData={notifications} reload={listAdminNotifications} href="/admin/calendar" />}
    />
  );
}
