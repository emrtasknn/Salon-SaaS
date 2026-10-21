export const dynamic = "force-dynamic";

import { listStaffAppointments } from "./actions";
import { StaffCalendar } from "./calendar";

function todayIso() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export default async function StaffPage() {
  const date = todayIso();
  const data = await listStaffAppointments(date);
  return <StaffCalendar initialDate={date} initialData={data} />;
}
