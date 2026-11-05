export const dynamic = "force-dynamic";

import { listAdminData } from "../actions";
import { StaffManagement } from "./staff-management";

// Data and authorization come from listAdminData (session tenant + role re-check).
export default async function AdminStaffPage() {
  return <StaffManagement initialData={await listAdminData()} />;
}
