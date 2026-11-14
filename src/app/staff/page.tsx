export const dynamic = "force-dynamic";

import { listStaffAppointments, listStaffNotifications } from "./actions";
import { StaffCalendar } from "./calendar";
import { InAppNotifications } from "../in-app-notifications";
import { parseCalendarDeepLink } from "../_ui/deep-link";
import { PushPermission } from "../pwa/push-permission";
import { readPushBindingKey } from "../_ui/push-binding-key";
import { formatGreetingDate } from "../_ui/greeting";
import { readViewerGreeting } from "../_ui/viewer-greeting";
import { greetingName } from "../_ui/display-name";

function todayIso() {
  const now = new Date();
  // Tenants are locked to Europe/Istanbul (MVP); UTC would show yesterday between 00:00 and 03:00.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { date, appointmentId } = parseCalendarDeepLink(await searchParams, todayIso());
  const [data, notifications, pushBindingKey, greeting] = await Promise.all([
    listStaffAppointments(date),
    listStaffNotifications(),
    readPushBindingKey(),
    readViewerGreeting(),
  ]);
  const firstName = greetingName(greeting.displayName);
  return (
    <StaffCalendar
      key={`${date}:${appointmentId ?? ""}`}
      initialDate={date}
      initialData={data}
      initialSelectedId={appointmentId}
      eyebrow={<>{greeting.tenantName ? `${greeting.tenantName} · ` : ""}<span className="tabular-nums">{formatGreetingDate(new Date())}</span></>}
      title={firstName ? `Merhaba, ${firstName}` : "Merhaba"}
      bell={<InAppNotifications initialData={notifications} reload={listStaffNotifications} href="/staff" />}
      pushPrompt={pushBindingKey ? <PushPermission bindingKey={pushBindingKey} className="w-full" layout="banner-only" /> : undefined}
    />
  );
}
