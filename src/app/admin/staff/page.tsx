export const dynamic = "force-dynamic";

import { listAdminData } from "../actions";
import { StaffManagement } from "./staff-management";

// Data and authorization come from listAdminData (session tenant + role re-check).
export default async function AdminStaffPage() {
  const data = await listAdminData();
  return <StaffManagement initialData={data} />;
}
