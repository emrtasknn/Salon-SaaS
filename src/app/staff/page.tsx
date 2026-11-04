export const dynamic = "force-dynamic";

import { listStaffAppointments, listStaffNotifications } from "./actions";
import { StaffCalendar } from "./calendar";
import { InAppNotifications } from "../in-app-notifications";

function todayIso() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export default async function StaffPage() {
  const date = todayIso();
  const [data, notifications] = await Promise.all([listStaffAppointments(date), listStaffNotifications()]);
  return <>
    <InAppNotifications initialData={notifications} reload={listStaffNotifications} href="/staff/appointments" className="bg-zinc-50 px-4 pt-4 sm:px-6" widthClassName="max-w-5xl" />
    <StaffCalendar initialDate={date} initialData={data} />
  </>;
}
