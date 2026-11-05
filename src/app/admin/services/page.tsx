export const dynamic = "force-dynamic";

import { listAdminData } from "../actions";
import { ServiceManagement } from "./service-management";

// Data and authorization come from listAdminData (session tenant + role re-check).
export default async function AdminServicesPage() {
  return <ServiceManagement initialData={await listAdminData()} />;
}
