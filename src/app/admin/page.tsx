export const dynamic = "force-dynamic";

import { listAdminData } from "./actions";
import { AdminManagement } from "./admin-management";

export default async function AdminPage() {
  const data = await listAdminData();
  return <AdminManagement initialData={data} />;
}
