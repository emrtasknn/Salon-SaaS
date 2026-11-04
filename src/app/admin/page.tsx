export const dynamic = "force-dynamic";

import { listAdminData } from "./actions";
import { listAdminNotifications } from "./calendar-actions";
import { AdminManagement } from "./admin-management";
import { InAppNotifications } from "../in-app-notifications";

export default async function AdminPage() {
  const [data, notifications] = await Promise.all([listAdminData(), listAdminNotifications()]);
  return <>
    <InAppNotifications initialData={notifications} reload={listAdminNotifications} href="/admin/calendar" className="bg-zinc-100 px-4 pt-4 sm:px-6" widthClassName="max-w-6xl" />
    <AdminManagement initialData={data} />
  </>;
}
