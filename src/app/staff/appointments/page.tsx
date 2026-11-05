export const dynamic = "force-dynamic";

import { listStaffAppointments, listStaffNotifications } from "../actions";
import { StaffAppointments } from "../appointments";
import { InAppNotifications } from "../../in-app-notifications";

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function StaffAppointmentsPage() {
  const date = todayIso();
  const [data, notifications] = await Promise.all([listStaffAppointments(date), listStaffNotifications()]);
  return <>
    <InAppNotifications initialData={notifications} reload={listStaffNotifications} href="/staff/appointments" className="bg-canvas px-4 pt-4 sm:px-6" widthClassName="max-w-4xl" />
    <StaffAppointments initialDate={date} initialData={data} />
  </>;
}
