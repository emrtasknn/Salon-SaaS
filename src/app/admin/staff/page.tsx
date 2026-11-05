export const dynamic = "force-dynamic";

import { listAdminData } from "../actions";
import { StaffManagement } from "./staff-management";
import { ServesAsStaffToggle } from "../serves-as-staff-toggle";

// Data and authorization come from listAdminData (session tenant + role re-check).
export default async function AdminStaffPage() {
  const data = await listAdminData();
  return <>
    {data.status === "ok" && (
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6">
        <ServesAsStaffToggle initialEnabled={data.adminServesAsStaff} />
      </div>
    )}
    <StaffManagement initialData={data} />
  </>;
}
