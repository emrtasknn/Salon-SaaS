import { TenantProvisioningForm } from "./tenant-provisioning-form";

export const dynamic = "force-dynamic";

export default function PlatformTenantsPage() {
  return (
    <main>
      <h1>Salon oluştur</h1>
      <p>Bu alan yalnızca platform SUPER_ADMIN hesabı içindir.</p>
      <TenantProvisioningForm />
    </main>
  );
}
