export const dynamic = "force-dynamic";

import { listStaffAppointments, listStaffNotifications } from "./actions";
import { StaffCalendar } from "./calendar";
import { InAppNotifications } from "../in-app-notifications";
import { createHash } from "node:crypto";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { PushPermission } from "../pwa/push-permission";
import { GreetingHeader } from "../_ui/greeting-header";
import { formatGreetingDate } from "../_ui/greeting";
import { readViewerGreeting } from "../_ui/viewer-greeting";

/**
 * WP-09: opaque, non-authoritative device-binding key for the push opt-in UI
 * (hash of tenant + auth subject). Never used for authorization; the push
 * actions derive tenant/profile from the session themselves.
 */
async function readPushBindingKey(): Promise<string | null> {
  try {
    const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
    const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
    if (request.state !== "authenticated") return null;
    return createHash("sha256")
      .update(`${request.tenantContext.tenantId}:${request.identity.subjectId}`)
      .digest("hex")
      .slice(0, 32);
  } catch {
    return null;
  }
}

function todayIso() {
  const now = new Date();
  // Tenants are locked to Europe/Istanbul (MVP); UTC would show yesterday between 00:00 and 03:00.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export default async function StaffPage() {
  const date = todayIso();
  const [data, notifications, pushBindingKey, greeting] = await Promise.all([
    listStaffAppointments(date),
    listStaffNotifications(),
    readPushBindingKey(),
    readViewerGreeting(),
  ]);
  const authorized = data.status !== "UNAUTHORIZED";
  return <>
    {authorized && (
      <div className="bg-canvas">
        <GreetingHeader
          displayName={greeting.displayName}
          tenantName={greeting.tenantName}
          dateLabel={formatGreetingDate(new Date())}
          widthClassName="max-w-5xl"
          asHeading={false}
          accessory={pushBindingKey ? <PushPermission bindingKey={pushBindingKey} /> : undefined}
        />
      </div>
    )}
    <InAppNotifications initialData={notifications} reload={listStaffNotifications} href="/staff/appointments" className="bg-canvas px-4 pt-4 sm:px-6" widthClassName="max-w-5xl" />
    <StaffCalendar initialDate={date} initialData={data} />
  </>;
}
