export const dynamic = "force-dynamic";

import { listAdminAppointments, listAdminNotifications } from "../calendar-actions";
import { AdminCalendar } from "../calendar";
import { InAppNotifications } from "../../in-app-notifications";

function todayIso() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export default async function AdminCalendarPage() {
  const date = todayIso();
  const [data, notifications] = await Promise.all([listAdminAppointments(date), listAdminNotifications()]);
  return <>
    <InAppNotifications initialData={notifications} reload={listAdminNotifications} href="/admin/calendar" className="bg-zinc-50 px-4 pt-4 sm:px-6" widthClassName="max-w-5xl" />
    <AdminCalendar initialDate={date} initialData={data} />
  </>;
}
