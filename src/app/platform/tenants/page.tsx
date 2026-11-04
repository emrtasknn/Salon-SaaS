import { listPlatformTenants, readPlatformAccess } from "./actions";
import { TenantProvisioningForm } from "./tenant-provisioning-form";
import { TenantStatusList } from "./tenant-status-list";

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

  const tenants = await listPlatformTenants();

  return (
    <main>
      <h1>Salonlar</h1>
      <section aria-labelledby="tenant-list-title">
        <h2 id="tenant-list-title">Salon listesi</h2>
        {tenants.ok ? (
          <TenantStatusList tenants={tenants.tenants} />
        ) : (
          <p role="status">Salon listesi yüklenemedi.</p>
        )}
      </section>
      <h2>Salon oluştur</h2>
      <p>Yeni salon ve ilk tenant admin hesabını oluşturun.</p>
      <TenantProvisioningForm />
    </main>
  );
}
