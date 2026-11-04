export const dynamic = "force-dynamic";

import { listAdminData } from "./actions";
import { listAdminNotifications } from "./calendar-actions";
import { loadTenantSettings } from "./settings-actions";
import { AdminManagement } from "./admin-management";
import { TenantSettingsForm } from "./tenant-settings-form";
import { InAppNotifications } from "../in-app-notifications";

export default async function AdminPage() {
  const [data, notifications, settings] = await Promise.all([
    listAdminData(),
    listAdminNotifications(),
    loadTenantSettings(),
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
      settings={authorized && settings.ok ? <TenantSettingsForm settings={settings.settings} canEdit={settings.canEdit === true} /> : undefined}
    />
  </>;
}
