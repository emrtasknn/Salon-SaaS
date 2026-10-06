export const dynamic = "force-dynamic";

import { listAdminAppointments } from "../calendar-actions";
import { AdminCalendar } from "../calendar";

function todayIso() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export default async function AdminCalendarPage() {
  const date = todayIso();
  const data = await listAdminAppointments(date);
  return <AdminCalendar initialDate={date} initialData={data} />;
}
