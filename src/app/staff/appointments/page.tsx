export const dynamic = "force-dynamic";

import { listStaffAppointments } from "../actions";
import { StaffAppointments } from "../appointments";

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function StaffAppointmentsPage() {
  const date = todayIso();
  const data = await listStaffAppointments(date);
  return <StaffAppointments initialDate={date} initialData={data} />;
}
