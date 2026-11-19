export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { listStaffAppointments, listStaffNotifications } from "./actions";
import { StaffHomeView } from "./home-view";
import { InAppNotifications } from "../in-app-notifications";
import { PushPermission } from "../pwa/push-permission";
import { readPushBindingKey } from "../_ui/push-binding-key";
import { readViewerGreeting } from "../_ui/viewer-greeting";
import { greetingName } from "../_ui/display-name";
import { addDays, todayInZone } from "../_ui/timeline-layout";

const CALENDAR = "/staff/calendar";

/**
 * Staff home ("Özet"): next appointment, today's numbers, waiting requests and today's list.
 * Everything comes from listStaffAppointments, which derives the staff member server-side.
 * Old notification links (/staff?date=…&appointment=…) still open the calendar.
 */
export default async function StaffHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.date !== undefined || params.appointment !== undefined) {
    const query = new URLSearchParams();
    for (const key of ["date", "appointment"] as const) {
      const value = params[key];
      if (typeof value === "string") query.set(key, value);
    }
    redirect(`${CALENDAR}?${query.toString()}`);
  }

  const today = todayInZone();
  const now = new Date();
  const [data, notifications, pushBindingKey, greeting] = await Promise.all([
    listStaffAppointments(today, addDays(today, 6)),
    listStaffNotifications(),
    readPushBindingKey(),
    readViewerGreeting(),
  ]);
  if (data.status === "UNAUTHORIZED") {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
        <h1 className="text-title">Yetkisiz erişim</h1>
        <p className="mt-2 text-body text-ink-muted">Bu alan aktif personel hesabına açıktır.</p>
      </main>
    );
  }

  return (
    <StaffHomeView
      appointments={data.status === "ok" ? data.appointments : []}
      loadFailed={data.status !== "ok"}
      now={now}
      today={today}
      tenantName={greeting.tenantName}
      firstName={greetingName(greeting.displayName)}
      bell={<InAppNotifications initialData={notifications} reload={listStaffNotifications} href={CALENDAR} />}
      pushPrompt={pushBindingKey ? <PushPermission bindingKey={pushBindingKey} className="w-full" layout="banner-only" /> : null}
    />
  );
}
