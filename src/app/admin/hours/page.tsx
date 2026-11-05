export const dynamic = "force-dynamic";

import { listAdminData } from "../actions";
import { WorkingHoursEditor } from "./working-hours-editor";

// Data and authorization come from listAdminData (session tenant + role re-check).
export default async function AdminHoursPage() {
  return <WorkingHoursEditor initialData={await listAdminData()} />;
}
