import { readPlatformAccess } from "./actions";
import { TenantProvisioningForm } from "./tenant-provisioning-form";

export const dynamic = "force-dynamic";

export default async function PlatformTenantsPage() {
  const allowed = await readPlatformAccess();

  if (!allowed) {
    return (
      <main>
        <h1>Yetkisiz erişim</h1>
        <p>Bu alan yalnızca platform SUPER_ADMIN hesabı içindir.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Salon oluştur</h1>
      <p>Yeni salon ve ilk tenant admin hesabını oluşturun.</p>
      <TenantProvisioningForm />
    </main>
  );
}
