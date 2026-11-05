export const dynamic = "force-dynamic";

import { listStaffAppointments, listStaffNotifications } from "../actions";
import { StaffAppointments } from "../appointments";
import { InAppNotifications } from "../../in-app-notifications";
import { todayInZone } from "../../_ui/timeline-layout";

export default async function StaffAppointmentsPage() {
  // Tenants are locked to Europe/Istanbul (MVP); UTC showed yesterday between 00:00 and 03:00.
  const date = todayInZone();
  const [data, notifications] = await Promise.all([listStaffAppointments(date), listStaffNotifications()]);
  return (
    <StaffAppointments
      initialDate={date}
      initialData={data}
      bell={<InAppNotifications initialData={notifications} reload={listStaffNotifications} href="/staff" />}
    />
  );
}
