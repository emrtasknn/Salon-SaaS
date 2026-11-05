export const dynamic = "force-dynamic";

import { listAdminAppointments, listAdminNotifications } from "../calendar-actions";
import { listClosures } from "../closure-actions";
import { AdminCalendar } from "../calendar";
import { InAppNotifications } from "../../in-app-notifications";
import { upcomingClosureRange } from "../../../domain/closure-date";
import { todayInZone } from "../../_ui/timeline-layout";
import type { ClosureListResult } from "../../appointment-create-contract";

export default async function AdminCalendarPage() {
  const date = todayInZone();
  const closureRange = upcomingClosureRange();
  const [data, notifications, closures] = await Promise.all([
    listAdminAppointments(date),
    listAdminNotifications(),
    listClosures(closureRange).catch((): ClosureListResult => ({ status: "INVALID_INPUT" })),
  ]);
  return <>
    <InAppNotifications initialData={notifications} reload={listAdminNotifications} href="/admin/calendar" className="bg-canvas px-4 pt-4 sm:px-6" widthClassName="max-w-5xl" />
    <AdminCalendar initialDate={date} initialData={data} closures={{ initialData: closures, range: closureRange }} />
  </>;
}
