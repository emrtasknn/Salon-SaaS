export const dynamic = "force-dynamic";

import { listAdminData } from "./actions";
import { listAdminNotifications } from "./calendar-actions";
import { loadTenantSettings } from "./settings-actions";
import { AdminManagement } from "./admin-management";
import { TenantSettingsForm } from "./tenant-settings-form";
import { InAppNotifications } from "../in-app-notifications";
import { listClosures } from "./closure-actions";
import { AdminClosures } from "./closures";
import { upcomingClosureRange } from "../../domain/closure-date";
import type { ClosureListResult } from "../appointment-create-contract";

export default async function AdminPage() {
  const closureRange = upcomingClosureRange();
  const [data, notifications, settings, closures] = await Promise.all([
    listAdminData(),
    listAdminNotifications(),
    loadTenantSettings(),
    // A closure read failure must not take down the whole admin page; the panel
    // shows "could not load" for INVALID_INPUT.
    listClosures(closureRange).catch((): ClosureListResult => ({ status: "INVALID_INPUT" })),
  ]);
  const authorized = data.status !== "UNAUTHORIZED";
  return <>
    {authorized && settings.ok && settings.settings.status === "INACTIVE" && (
      <div className="bg-zinc-100 px-4 pt-4 sm:px-6">
        <p role="status" className="mx-auto max-w-6xl rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900">
          Salonunuz şu anda pasif — online ve yeni randevu alınmıyor.
        </p>
      </div>
    )}
    <InAppNotifications initialData={notifications} reload={listAdminNotifications} href="/admin/calendar" className="bg-zinc-100 px-4 pt-4 sm:px-6" widthClassName="max-w-6xl" />
    <AdminManagement
      initialData={data}
      settings={authorized ? <>
        {settings.ok && <TenantSettingsForm settings={settings.settings} canEdit={settings.canEdit === true} />}
        <AdminClosures initialData={closures} initialRange={closureRange} />
      </> : undefined}
    />
  </>;
}
